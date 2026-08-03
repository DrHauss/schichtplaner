import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { pruefeKonflikte } from "../lib/regelwerk";
import { benachrichtige } from "../lib/notify";
import {
  requirePlanerFuerAusschreibung,
  istPlanerFuerAusschreibung,
  istPlanerFuerPlanungseinheit,
  istIrgendeinPlaner,
} from "../lib/berechtigung";

export const boerseRouter = Router();
boerseRouter.use(requireAuth);

function teamsFuerAusschreibung(ausschreibungId: number | string): { id: number; name: string }[] {
  return db
    .prepare(
      `SELECT p.id, p.name FROM ausschreibung_team at JOIN planungseinheit p ON p.id = at.planungseinheit_id
       WHERE at.ausschreibung_id = ? ORDER BY p.name`
    )
    .all(ausschreibungId) as { id: number; name: string }[];
}

// --- Ausschreibungen ---

// Sichtbar sind global laufende Ausschreibungen (kein Team verknuepft) sowie alle, die an ein
// Team gebunden sind, in dem der Nutzer Mitglied ist (jede Rolle); Admin sieht alles.
boerseRouter.get("/ausschreibungen", (req: AuthedRequest, res) => {
  const rows = (
    req.user!.istAdmin
      ? db.prepare("SELECT * FROM ausschreibung ORDER BY erstellt_am DESC").all()
      : db
          .prepare(
            `SELECT DISTINCT a.* FROM ausschreibung a
             LEFT JOIN ausschreibung_team at ON at.ausschreibung_id = a.id
             WHERE at.ausschreibung_id IS NULL
                OR at.planungseinheit_id IN (SELECT planungseinheit_id FROM mitgliedschaft WHERE benutzer_id = ?)
             ORDER BY a.erstellt_am DESC`
          )
          .all(req.user!.sub)
  ) as any[];
  res.json(rows.map((a) => ({ ...a, teams: teamsFuerAusschreibung(a.id) })));
});

boerseRouter.get("/ausschreibungen/:id", (req: AuthedRequest, res) => {
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(req.params.id) as any;
  if (!ausschreibung) return res.status(404).json({ error: "Nicht gefunden" });
  res.json({ ...ausschreibung, teams: teamsFuerAusschreibung(req.params.id), istPlaner: istPlanerFuerAusschreibung(req, req.params.id) });
});

// planungseinheitIds: [] = global (alle Teams/alle Mitarbeiter), sonst 1 oder mehrere gezielt
// gewaehlte Teams -- der Ersteller muss fuer jedes davon Planer sein (bzw. bei globaler
// Ausschreibung Planer irgendeiner Einheit).
boerseRouter.post("/ausschreibungen", (req: AuthedRequest, res) => {
  const { titel, bewerbungsfrist, vergabeverfahren, minBloecke, maxBloecke, planungseinheitIds } = req.body ?? {};
  if (!titel || !bewerbungsfrist) return res.status(400).json({ error: "titel und bewerbungsfrist erforderlich" });
  const teamIds: number[] = Array.isArray(planungseinheitIds) ? planungseinheitIds : [];
  const berechtigt =
    teamIds.length === 0 ? istIrgendeinPlaner(req) : teamIds.every((id) => istPlanerFuerPlanungseinheit(req, id));
  if (!berechtigt) return res.status(403).json({ error: "Keine Planer-Berechtigung fuer eines der ausgewaehlten Teams" });

  const ergebnis = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO ausschreibung (titel, bewerbungsfrist, vergabeverfahren, min_bloecke, max_bloecke)
         VALUES (?,?,?,?,?)`
      )
      .run(titel, bewerbungsfrist, vergabeverfahren ?? "manuell", minBloecke ?? null, maxBloecke ?? null);
    const id = info.lastInsertRowid;
    const insertTeam = db.prepare("INSERT INTO ausschreibung_team (ausschreibung_id, planungseinheit_id) VALUES (?,?)");
    for (const teamId of teamIds) insertTeam.run(id, teamId);
    return id;
  })();

  res.status(201).json({ id: ergebnis });
});

boerseRouter.post("/ausschreibungen/:id/schichtbloecke", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { bezeichnung, personenBedarf, qualifikationId, schichten } = req.body ?? {};
  // schichten: [{ datum, schichtartId }, ...]
  if (!bezeichnung || !Array.isArray(schichten) || schichten.length === 0) {
    return res.status(400).json({ error: "bezeichnung und schichten[] erforderlich" });
  }
  const info = db
    .prepare("INSERT INTO schichtblock (ausschreibung_id, bezeichnung, personen_bedarf, qualifikation_id) VALUES (?,?,?,?)")
    .run(req.params.id, bezeichnung, personenBedarf ?? 1, qualifikationId ?? null);
  const blockId = info.lastInsertRowid;
  const insertSchicht = db.prepare("INSERT INTO blockschicht (schichtblock_id, datum, schichtart_id) VALUES (?,?,?)");
  for (const s of schichten) insertSchicht.run(blockId, s.datum, s.schichtartId);
  res.status(201).json({ id: blockId });
});

boerseRouter.post("/ausschreibungen/:id/veroeffentlichen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  db.prepare("UPDATE ausschreibung SET status = 'veroeffentlicht' WHERE id = ?").run(req.params.id);
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(req.params.id) as any;
  const teamIds = teamsFuerAusschreibung(req.params.id).map((t) => t.id);
  // Keine Teams verknuepft = globale Ausschreibung -- dann alle Mitarbeiter systemweit benachrichtigen.
  const mitarbeiter = (
    teamIds.length === 0
      ? db.prepare("SELECT DISTINCT benutzer_id FROM mitgliedschaft WHERE rolle = 'mitarbeiter'").all()
      : db
          .prepare(
            `SELECT DISTINCT benutzer_id FROM mitgliedschaft
             WHERE rolle = 'mitarbeiter' AND planungseinheit_id IN (${teamIds.map(() => "?").join(",")})`
          )
          .all(...teamIds)
  ) as { benutzer_id: number }[];
  for (const m of mitarbeiter) {
    benachrichtige(m.benutzer_id, "neue_ausschreibung", { ausschreibungId: ausschreibung.id, titel: ausschreibung.titel });
  }
  res.json({ ok: true });
});

// Liste offener Bloecke inkl. Bewerbungsstatus des angemeldeten Nutzers
boerseRouter.get("/ausschreibungen/:id/schichtbloecke", (req: AuthedRequest, res) => {
  const bloecke = db.prepare("SELECT * FROM schichtblock WHERE ausschreibung_id = ?").all(req.params.id) as any[];
  const result = bloecke.map((block) => {
    // LEFT JOIN auf beide Tabellen, da ein Eintrag entweder eine Schicht ODER eine Bereitschaft
    // ist (siehe blockschicht in lib/db.ts) -- COALESCE liefert die jeweils passenden Felder.
    const schichten = db
      .prepare(
        `SELECT bs.datum, COALESCE(sa.kuerzel, ba.kuerzel) as kuerzel, COALESCE(sa.bezeichnung, ba.bezeichnung) as bezeichnung,
                sa.beginn, sa.ende, (ba.id IS NOT NULL) as istBereitschaft
         FROM blockschicht bs
         LEFT JOIN schichtart sa ON sa.id = bs.schichtart_id
         LEFT JOIN bereitschaftsart ba ON ba.id = bs.bereitschaftsart_id
         WHERE bs.schichtblock_id = ? ORDER BY bs.datum`
      )
      .all(block.id);
    const bewerbungen = db.prepare("SELECT * FROM bewerbung WHERE schichtblock_id = ?").all(block.id);
    const eigeneBewerbung = db
      .prepare("SELECT * FROM bewerbung WHERE schichtblock_id = ? AND benutzer_id = ?")
      .get(block.id, req.user!.sub);
    const vergeben = db.prepare("SELECT COUNT(*) c FROM vergabe_protokoll WHERE schichtblock_id = ?").get(block.id) as {
      c: number;
    };
    return { ...block, schichten, anzahlBewerbungen: bewerbungen.length, eigeneBewerbung, anzahlVergeben: vergeben.c };
  });
  res.json(result);
});

// --- Bewerbung ---

boerseRouter.post("/schichtbloecke/:id/bewerbungen", (req: AuthedRequest, res) => {
  const { prioritaet, kommentar } = req.body ?? {};
  const schichten = db.prepare("SELECT * FROM blockschicht WHERE schichtblock_id = ?").all(req.params.id) as {
    datum: string;
    schichtart_id: number | null;
  }[];

  const warnungen: unknown[] = [];
  for (const s of schichten) {
    // Bereitschaften loesen keine Doppelbelegungs-/Ruhezeit-Pruefung aus (keine Schicht).
    if (s.schichtart_id == null) continue;
    const konflikte = pruefeKonflikte(req.user!.sub, s.schichtart_id, s.datum);
    warnungen.push(...konflikte);
  }

  db.prepare(
    `INSERT INTO bewerbung (schichtblock_id, benutzer_id, prioritaet, kommentar, status)
     VALUES (?,?,?,?,'offen')
     ON CONFLICT(schichtblock_id, benutzer_id) DO UPDATE SET prioritaet = excluded.prioritaet, kommentar = excluded.kommentar, status = 'offen'`
  ).run(req.params.id, req.user!.sub, prioritaet ?? 1, kommentar ?? null);

  res.status(201).json({ ok: true, warnungen });
});

boerseRouter.post("/schichtbloecke/:id/bewerbungen/zurueckziehen", (req: AuthedRequest, res) => {
  db.prepare("UPDATE bewerbung SET status = 'zurueckgezogen' WHERE schichtblock_id = ? AND benutzer_id = ?").run(
    req.params.id,
    req.user!.sub
  );
  res.json({ ok: true });
});

// Meine Bewerbungen (Mitarbeiter-Selbstansicht)
boerseRouter.get("/meine-bewerbungen", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT bw.*, sb.bezeichnung as block_bezeichnung, a.titel as ausschreibung_titel
       FROM bewerbung bw
       JOIN schichtblock sb ON sb.id = bw.schichtblock_id
       JOIN ausschreibung a ON a.id = sb.ausschreibung_id
       WHERE bw.benutzer_id = ? ORDER BY bw.zeitstempel DESC`
    )
    .all(req.user!.sub);
  res.json(rows);
});

// --- Vergabe ---

// Vergabeuebersicht je Block: Bewerber mit Prioritaet, Stundenkonto-Naeherung, Vergabehistorie-Zaehler
boerseRouter.get("/schichtbloecke/:id/vergabeuebersicht", (req, res) => {
  const bewerbungen = db
    .prepare(
      `SELECT bw.*, b.name, b.wochenstunden FROM bewerbung bw JOIN benutzer b ON b.id = bw.benutzer_id
       WHERE bw.schichtblock_id = ? AND bw.status = 'offen' ORDER BY bw.prioritaet ASC, bw.zeitstempel ASC`
    )
    .all(req.params.id) as any[];

  const mitFairness = bewerbungen.map((bw) => {
    const letzteVergaben = db
      .prepare(
        `SELECT COUNT(*) c FROM vergabe_protokoll vp
         WHERE vp.benutzer_id = ? AND vp.entschieden_am >= date('now', '-90 day')`
      )
      .get(bw.benutzer_id) as { c: number };
    return { ...bw, vergabenLetzte90Tage: letzteVergaben.c };
  });

  // Fairness-Vorschlag: wenigste Vergaben zuerst, dann Prioritaet, dann Zeitstempel
  const vorschlag = [...mitFairness].sort((a, b) => {
    if (a.vergabenLetzte90Tage !== b.vergabenLetzte90Tage) return a.vergabenLetzte90Tage - b.vergabenLetzte90Tage;
    if (a.prioritaet !== b.prioritaet) return a.prioritaet - b.prioritaet;
    return a.zeitstempel.localeCompare(b.zeitstempel);
  });

  res.json({ bewerbungen: mitFairness, fairnessVorschlag: vorschlag.map((v) => v.benutzer_id) });
});

// Block an einen oder mehrere Mitarbeiter vergeben
boerseRouter.post("/schichtbloecke/:id/vergeben", (req: AuthedRequest, res) => {
  const { benutzerIds, begruendung } = req.body ?? {};
  if (!Array.isArray(benutzerIds) || benutzerIds.length === 0) {
    return res.status(400).json({ error: "benutzerIds[] erforderlich" });
  }

  const block = db.prepare("SELECT * FROM schichtblock WHERE id = ?").get(req.params.id) as any;
  if (!block) return res.status(404).json({ error: "Schichtblock nicht gefunden" });
  if (!istPlanerFuerAusschreibung(req, block.ausschreibung_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Ausschreibung" });
  }
  const schichten = db.prepare("SELECT * FROM blockschicht WHERE schichtblock_id = ?").all(req.params.id) as {
    datum: string;
    schichtart_id: number | null;
    bereitschaftsart_id: number | null;
  }[];

  const tx = db.transaction((ids: number[]) => {
    for (const benutzerId of ids) {
      db.prepare(
        "INSERT INTO vergabe_protokoll (schichtblock_id, benutzer_id, entschieden_von, begruendung) VALUES (?,?,?,?)"
      ).run(req.params.id, benutzerId, req.user!.sub, begruendung ?? null);

      db.prepare("UPDATE bewerbung SET status = 'zugesagt' WHERE schichtblock_id = ? AND benutzer_id = ?").run(
        req.params.id,
        benutzerId
      );

      // Schicht-Eintraege landen in schicht_zuweisung, Bereitschafts-Eintraege in
      // bereitschaft_zuweisung -- ein Block ist immer einheitlich das eine oder das andere.
      for (const s of schichten) {
        if (s.schichtart_id != null) {
          db.prepare(
            `INSERT INTO schicht_zuweisung (benutzer_id, schichtart_id, datum, status, quelle) VALUES (?,?,?,'entwurf','boerse')
             ON CONFLICT(benutzer_id, datum, schichtart_id) DO NOTHING`
          ).run(benutzerId, s.schichtart_id, s.datum);
        } else if (s.bereitschaftsart_id != null) {
          db.prepare(
            `INSERT INTO bereitschaft_zuweisung (benutzer_id, bereitschaftsart_id, datum, status, quelle) VALUES (?,?,?,'entwurf','boerse')
             ON CONFLICT(benutzer_id, bereitschaftsart_id, datum) DO NOTHING`
          ).run(benutzerId, s.bereitschaftsart_id, s.datum);
        }
      }
      benachrichtige(benutzerId, "bewerbung_zugesagt", { schichtblockId: req.params.id, bezeichnung: block.bezeichnung });
    }

    // alle anderen offenen Bewerber dieses Blocks absagen
    const andere = db
      .prepare("SELECT benutzer_id FROM bewerbung WHERE schichtblock_id = ? AND status = 'offen'")
      .all(req.params.id) as { benutzer_id: number }[];
    for (const a of andere) {
      db.prepare("UPDATE bewerbung SET status = 'abgelehnt' WHERE schichtblock_id = ? AND benutzer_id = ?").run(
        req.params.id,
        a.benutzer_id
      );
      benachrichtige(a.benutzer_id, "bewerbung_abgelehnt", { schichtblockId: req.params.id, bezeichnung: block.bezeichnung });
    }
  });

  tx(benutzerIds);
  res.json({ ok: true });
});
