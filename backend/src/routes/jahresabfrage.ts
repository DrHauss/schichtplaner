import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import {
  requirePlanerFuerAusschreibung,
  istPlanerFuerAusschreibung,
  istPlanerFuerPlanungseinheit,
  istIrgendeinPlaner,
} from "../lib/berechtigung";
import { berechneTermine, gruppiere, schichtartFuerDatum, Regel, Ausnahme, Gruppierung } from "../lib/terminserie";
import { baueRaster, schreibeAntworten, legeTeilnehmerAn, erinnereAusstehende, ladeVorgabenStatus, istVollstaendig } from "../lib/jahresabfrage";
import { berechneVergabevorschlag } from "../lib/vergabevorschlag";
import { benachrichtige } from "../lib/notify";

export const jahresabfrageRouter = Router();
jahresabfrageRouter.use(requireAuth);

// --- Anlegen ---

// planungseinheitIds: [] = global (alle Teams), sonst 1 oder mehrere gezielt gewaehlte Teams --
// gleiches Muster wie bei den Schichtboerse-Ausschreibungen in boerse.ts.
jahresabfrageRouter.post("/jahresabfragen", (req: AuthedRequest, res) => {
  const { titel, zeitraumVon, zeitraumBis, bewerbungsfrist, antwortModus, sichtbarkeit, zugang, planungseinheitIds } = req.body ?? {};
  if (!titel || !zeitraumVon || !zeitraumBis || !bewerbungsfrist) {
    return res.status(400).json({ error: "titel, zeitraumVon, zeitraumBis, bewerbungsfrist erforderlich" });
  }
  const teamIds: number[] = Array.isArray(planungseinheitIds) ? planungseinheitIds : [];
  const berechtigt =
    teamIds.length === 0 ? istIrgendeinPlaner(req) : teamIds.every((id) => istPlanerFuerPlanungseinheit(req, id));
  if (!berechtigt) return res.status(403).json({ error: "Keine Planer-Berechtigung fuer eines der ausgewaehlten Teams" });

  const ergebnis = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO ausschreibung
           (titel, bewerbungsfrist, vergabeverfahren, typ, zeitraum_von, zeitraum_bis, antwort_modus, sichtbarkeit, zugang)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        titel,
        bewerbungsfrist,
        "fairness",
        "jahresabfrage",
        zeitraumVon,
        zeitraumBis,
        antwortModus ?? "ja_wennnoetig_nein",
        sichtbarkeit ?? "alle",
        zugang ?? "link_persoenlich"
      );
    const id = info.lastInsertRowid;
    const insertTeam = db.prepare("INSERT INTO ausschreibung_team (ausschreibung_id, planungseinheit_id) VALUES (?,?)");
    for (const teamId of teamIds) insertTeam.run(id, teamId);
    return id;
  })();

  res.status(201).json({ id: ergebnis });
});

// --- Terminserien-Generator ---

jahresabfrageRouter.post("/ausschreibungen/:id/terminserien/vorschau", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { regel, ausnahmen, gruppierung, bezeichnung } = (req.body ?? {}) as {
    regel: Regel;
    ausnahmen?: Ausnahme[];
    gruppierung?: Gruppierung;
    bezeichnung?: string;
  };
  try {
    const termine = berechneTermine(regel, ausnahmen ?? []);
    const bloecke = gruppiere(termine, gruppierung ?? "pro_termin", bezeichnung ?? "Termin");
    res.json({ anzahlTermine: termine.length, anzahlBloecke: bloecke.length, bloecke });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

jahresabfrageRouter.get("/ausschreibungen/:id/terminserien", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const serien = db.prepare("SELECT * FROM terminserie WHERE ausschreibung_id = ? ORDER BY erstellt_am").all(req.params.id) as any[];
  const mitAnzahl = serien.map((s) => {
    const anzahl = db.prepare("SELECT COUNT(*) c FROM schichtblock WHERE terminserie_id = ?").get(s.id) as { c: number };
    return { ...s, anzahlBloecke: anzahl.c };
  });
  res.json(mitAnzahl);
});

// Eine Terminserie ist entweder ganz Schicht- oder ganz Bereitschafts-basiert (kein Mischen
// innerhalb einer Serie) -- genau eines von schichtartIds/bereitschaftsartIds wird angegeben.
jahresabfrageRouter.post("/ausschreibungen/:id/terminserien", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { bezeichnung, regel, ausnahmen, gruppierung, schichtartIds, bereitschaftsartIds, personenBedarf, qualifikationId, mindestZusagen } =
    (req.body ?? {}) as {
      bezeichnung: string;
      regel: Regel;
      ausnahmen?: Ausnahme[];
      gruppierung?: Gruppierung;
      schichtartIds?: number[];
      bereitschaftsartIds?: number[];
      personenBedarf?: number;
      qualifikationId?: number;
      mindestZusagen?: number;
    };
  const istBereitschaft = Array.isArray(bereitschaftsartIds) && bereitschaftsartIds.length > 0;
  const ids = istBereitschaft ? bereitschaftsartIds! : schichtartIds;
  if (!bezeichnung || !regel || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "bezeichnung, regel und schichtartIds[] oder bereitschaftsartIds[] erforderlich" });
  }

  let termine: string[];
  try {
    termine = berechneTermine(regel, ausnahmen ?? []);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  if (termine.length === 0) return res.status(400).json({ error: "Regel ergibt keine Termine" });

  const bloecke = gruppiere(termine, gruppierung ?? "pro_termin", bezeichnung);

  const insertSerie = db.prepare(
    `INSERT INTO terminserie (ausschreibung_id, bezeichnung, regel, schichtart_ids, bereitschaftsart_ids, personen_bedarf, qualifikation_id, ausnahmen, mindest_zusagen)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const insertBlock = db.prepare(
    "INSERT INTO schichtblock (ausschreibung_id, bezeichnung, personen_bedarf, qualifikation_id, terminserie_id, datum_sort) VALUES (?,?,?,?,?,?)"
  );
  const insertSchicht = db.prepare("INSERT INTO blockschicht (schichtblock_id, datum, schichtart_id, bereitschaftsart_id) VALUES (?,?,?,?)");

  const ergebnis = db.transaction(() => {
    const serieInfo = insertSerie.run(
      req.params.id,
      bezeichnung,
      JSON.stringify(regel),
      istBereitschaft ? "[]" : JSON.stringify(ids),
      istBereitschaft ? JSON.stringify(ids) : null,
      personenBedarf ?? 1,
      qualifikationId ?? null,
      JSON.stringify(ausnahmen ?? []),
      mindestZusagen ?? null
    );
    const serieId = serieInfo.lastInsertRowid;
    for (const block of bloecke) {
      const blockInfo = insertBlock.run(req.params.id, block.bezeichnung, personenBedarf ?? 1, qualifikationId ?? null, serieId, block.termine[0]);
      for (const datum of block.termine) {
        const gewaehlteId = schichtartFuerDatum(datum, regel, ids);
        insertSchicht.run(blockInfo.lastInsertRowid, datum, istBereitschaft ? null : gewaehlteId, istBereitschaft ? gewaehlteId : null);
      }
    }
    return serieId;
  })();

  res.status(201).json({ id: ergebnis, anzahlBloecke: bloecke.length, anzahlTermine: termine.length });
});

jahresabfrageRouter.put("/ausschreibungen/:id/terminserien/:sid", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { mindestZusagen } = req.body ?? {};
  db.prepare("UPDATE terminserie SET mindest_zusagen = ? WHERE id = ? AND ausschreibung_id = ?").run(
    mindestZusagen === "" || mindestZusagen == null ? null : mindestZusagen,
    req.params.sid,
    req.params.id
  );
  res.json({ ok: true });
});

jahresabfrageRouter.delete("/ausschreibungen/:id/terminserien/:sid", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  db.prepare("DELETE FROM terminserie WHERE id = ? AND ausschreibung_id = ?").run(req.params.sid, req.params.id);
  res.json({ ok: true });
});

// Individuelle Mindestanzahl je Teilnehmer fuer eine Terminserie -- weicht vom Standard der
// Serie ab (z. B. weniger Nachtschichten fuer Teilzeitkraefte).
jahresabfrageRouter.get("/ausschreibungen/:id/terminserien/:sid/mindestzusagen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const serie = db.prepare("SELECT * FROM terminserie WHERE id = ? AND ausschreibung_id = ?").get(req.params.sid, req.params.id) as
    | { mindest_zusagen: number | null }
    | undefined;
  if (!serie) return res.status(404).json({ error: "Terminserie nicht gefunden" });
  const teilnehmer = db.prepare("SELECT id, name FROM abfrage_teilnehmer WHERE ausschreibung_id = ? ORDER BY name").all(req.params.id) as {
    id: number;
    name: string;
  }[];
  const overrides = db
    .prepare("SELECT teilnehmer_id, mindest_zusagen FROM terminserie_mindestzusagen WHERE terminserie_id = ?")
    .all(req.params.sid) as { teilnehmer_id: number; mindest_zusagen: number }[];
  const overrideMap = new Map(overrides.map((o) => [o.teilnehmer_id, o.mindest_zusagen]));
  res.json({
    standard: serie.mindest_zusagen,
    teilnehmer: teilnehmer.map((t) => ({ teilnehmerId: t.id, name: t.name, override: overrideMap.get(t.id) ?? null })),
  });
});

jahresabfrageRouter.put("/ausschreibungen/:id/terminserien/:sid/mindestzusagen/:teilnehmerId", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { mindestZusagen } = req.body ?? {};
  if (mindestZusagen === "" || mindestZusagen === null || mindestZusagen === undefined) {
    db.prepare("DELETE FROM terminserie_mindestzusagen WHERE terminserie_id = ? AND teilnehmer_id = ?").run(
      req.params.sid,
      req.params.teilnehmerId
    );
  } else {
    db.prepare(
      `INSERT INTO terminserie_mindestzusagen (terminserie_id, teilnehmer_id, mindest_zusagen) VALUES (?,?,?)
       ON CONFLICT(terminserie_id, teilnehmer_id) DO UPDATE SET mindest_zusagen = excluded.mindest_zusagen`
    ).run(req.params.sid, req.params.teilnehmerId, mindestZusagen);
  }
  res.json({ ok: true });
});

// --- Gruppen: mehrere Terminserien mit gemeinsamer Mindestanzahl (z. B. "Wochenenddienste" aus
// Fruehschicht + Spaetschicht, mind. 3 Zusagen insgesamt) ---

jahresabfrageRouter.get("/ausschreibungen/:id/gruppen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const gruppen = db
    .prepare("SELECT * FROM terminserie_gruppe WHERE ausschreibung_id = ? ORDER BY erstellt_am")
    .all(req.params.id) as any[];
  const mitMitgliedern = gruppen.map((g) => {
    const mitglieder = db
      .prepare(
        `SELECT t.id, t.bezeichnung FROM terminserie_gruppe_mitglied m JOIN terminserie t ON t.id = m.terminserie_id
         WHERE m.gruppe_id = ? ORDER BY t.bezeichnung`
      )
      .all(g.id) as { id: number; bezeichnung: string }[];
    return { ...g, mitglieder };
  });
  res.json(mitMitgliedern);
});

jahresabfrageRouter.post("/ausschreibungen/:id/gruppen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { bezeichnung, terminserieIds, mindestZusagen } = (req.body ?? {}) as {
    bezeichnung: string;
    terminserieIds: number[];
    mindestZusagen?: number;
  };
  if (!bezeichnung || !Array.isArray(terminserieIds) || terminserieIds.length < 2) {
    return res.status(400).json({ error: "bezeichnung und mindestens zwei terminserieIds erforderlich" });
  }
  const gueltig = db
    .prepare(
      `SELECT COUNT(*) c FROM terminserie WHERE ausschreibung_id = ? AND id IN (${terminserieIds.map(() => "?").join(",")})`
    )
    .get(req.params.id, ...terminserieIds) as { c: number };
  if (gueltig.c !== terminserieIds.length) {
    return res.status(400).json({ error: "Terminserien gehoeren nicht zu dieser Jahresabfrage" });
  }

  const ergebnis = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO terminserie_gruppe (ausschreibung_id, bezeichnung, mindest_zusagen) VALUES (?,?,?)")
      .run(req.params.id, bezeichnung, mindestZusagen ?? null);
    const gruppeId = info.lastInsertRowid;
    const insertMitglied = db.prepare("INSERT INTO terminserie_gruppe_mitglied (gruppe_id, terminserie_id) VALUES (?,?)");
    for (const sid of terminserieIds) insertMitglied.run(gruppeId, sid);
    return gruppeId;
  })();

  res.status(201).json({ id: ergebnis });
});

jahresabfrageRouter.put("/ausschreibungen/:id/gruppen/:gid", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { mindestZusagen } = req.body ?? {};
  db.prepare("UPDATE terminserie_gruppe SET mindest_zusagen = ? WHERE id = ? AND ausschreibung_id = ?").run(
    mindestZusagen === "" || mindestZusagen == null ? null : mindestZusagen,
    req.params.gid,
    req.params.id
  );
  res.json({ ok: true });
});

jahresabfrageRouter.delete("/ausschreibungen/:id/gruppen/:gid", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  db.prepare("DELETE FROM terminserie_gruppe WHERE id = ? AND ausschreibung_id = ?").run(req.params.gid, req.params.id);
  res.json({ ok: true });
});

jahresabfrageRouter.get("/ausschreibungen/:id/gruppen/:gid/mindestzusagen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const gruppe = db.prepare("SELECT * FROM terminserie_gruppe WHERE id = ? AND ausschreibung_id = ?").get(req.params.gid, req.params.id) as
    | { mindest_zusagen: number | null }
    | undefined;
  if (!gruppe) return res.status(404).json({ error: "Gruppe nicht gefunden" });
  const teilnehmer = db.prepare("SELECT id, name FROM abfrage_teilnehmer WHERE ausschreibung_id = ? ORDER BY name").all(req.params.id) as {
    id: number;
    name: string;
  }[];
  const overrides = db
    .prepare("SELECT teilnehmer_id, mindest_zusagen FROM gruppe_mindestzusagen WHERE gruppe_id = ?")
    .all(req.params.gid) as { teilnehmer_id: number; mindest_zusagen: number }[];
  const overrideMap = new Map(overrides.map((o) => [o.teilnehmer_id, o.mindest_zusagen]));
  res.json({
    standard: gruppe.mindest_zusagen,
    teilnehmer: teilnehmer.map((t) => ({ teilnehmerId: t.id, name: t.name, override: overrideMap.get(t.id) ?? null })),
  });
});

jahresabfrageRouter.put("/ausschreibungen/:id/gruppen/:gid/mindestzusagen/:teilnehmerId", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { mindestZusagen } = req.body ?? {};
  if (mindestZusagen === "" || mindestZusagen === null || mindestZusagen === undefined) {
    db.prepare("DELETE FROM gruppe_mindestzusagen WHERE gruppe_id = ? AND teilnehmer_id = ?").run(req.params.gid, req.params.teilnehmerId);
  } else {
    db.prepare(
      `INSERT INTO gruppe_mindestzusagen (gruppe_id, teilnehmer_id, mindest_zusagen) VALUES (?,?,?)
       ON CONFLICT(gruppe_id, teilnehmer_id) DO UPDATE SET mindest_zusagen = excluded.mindest_zusagen`
    ).run(req.params.gid, req.params.teilnehmerId, mindestZusagen);
  }
  res.json({ ok: true });
});

// --- Rasteransicht ---

jahresabfrageRouter.get("/ausschreibungen/:id/raster", (req: AuthedRequest, res) => {
  const ausschreibung = db.prepare("SELECT id FROM ausschreibung WHERE id = ?").get(req.params.id);
  if (!ausschreibung) return res.status(404).json({ error: "Nicht gefunden" });
  const istPlaner = istPlanerFuerAusschreibung(req, req.params.id);
  const raster = baueRaster(req.params.id, { requesterBenutzerId: req.user!.sub, istPlaner });
  res.json(raster);
});

jahresabfrageRouter.put("/ausschreibungen/:id/antworten", (req: AuthedRequest, res) => {
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(req.params.id) as any;
  if (!ausschreibung) return res.status(404).json({ error: "Nicht gefunden" });
  if (ausschreibung.status === "geschlossen") return res.status(409).json({ error: "Frist bereits abgelaufen" });
  const { antworten } = req.body ?? {};
  if (!Array.isArray(antworten)) return res.status(400).json({ error: "antworten[] erforderlich" });
  res.json(schreibeAntworten(req.params.id, req.user!.sub, antworten));
});

// --- Teilnehmerkreis, Einladung, Erinnerung, Fortschritt ---

jahresabfrageRouter.get("/ausschreibungen/:id/teilnehmer", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  res.json(db.prepare("SELECT * FROM abfrage_teilnehmer WHERE ausschreibung_id = ? ORDER BY name").all(req.params.id));
});

jahresabfrageRouter.post("/ausschreibungen/:id/teilnehmer", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { teilnehmer, ausMitarbeitern } = req.body ?? {};

  const teamIds = (
    db.prepare("SELECT planungseinheit_id FROM ausschreibung_team WHERE ausschreibung_id = ?").all(req.params.id) as {
      planungseinheit_id: number;
    }[]
  ).map((t) => t.planungseinheit_id);

  const eintraege: { name: string; email?: string; wunschAnzahl?: number; benutzerId?: number }[] = [];
  if (ausMitarbeitern) {
    // Ohne verknuepftes Team (globale Ausschreibung) zaehlen alle Mitarbeiter systemweit als
    // Teilnehmerkreis, sonst die Mitarbeiter der verknuepften Teams.
    const mitarbeiter = (
      teamIds.length === 0
        ? db.prepare(
            `SELECT DISTINCT b.id, b.name, b.email FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
             WHERE m.rolle = 'mitarbeiter'`
          )
        : db.prepare(
            `SELECT DISTINCT b.id, b.name, b.email FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
             WHERE m.rolle = 'mitarbeiter' AND m.planungseinheit_id IN (${teamIds.map(() => "?").join(",")})`
          )
    ).all(...(teamIds.length === 0 ? [] : teamIds)) as any[];
    for (const m of mitarbeiter) eintraege.push({ name: m.name, email: m.email, benutzerId: m.id });
  }
  if (Array.isArray(teilnehmer)) {
    for (const t of teilnehmer) if (t?.name) eintraege.push({ name: t.name, email: t.email, wunschAnzahl: t.wunschAnzahl });
  }
  if (eintraege.length === 0) return res.status(400).json({ error: "teilnehmer[] oder ausMitarbeitern erforderlich" });

  // Neu angelegte Teilnehmer (ohne bestehendes Konto) werden Mitglied des ersten verknuepften
  // Teams, damit sie ueberhaupt irgendwo im Roster (Plantafel etc.) auftauchen; bei einer
  // globalen Ausschreibung gibt es kein eindeutig "zustaendiges" Team, dann bleibt es dabei,
  // dass nur ein Konto ohne Mitgliedschaft angelegt wird.
  const primaryTeamId = teamIds[0] ?? null;
  const angelegt = eintraege.map((e) => legeTeilnehmerAn(req.params.id, primaryTeamId, e));
  res.status(201).json({ anzahl: angelegt.length, teilnehmer: angelegt });
});

jahresabfrageRouter.post("/ausschreibungen/:id/einladen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const teilnehmer = db
    .prepare("SELECT * FROM abfrage_teilnehmer WHERE ausschreibung_id = ? AND eingeladen_am IS NULL")
    .all(req.params.id) as any[];
  const links = teilnehmer.map((t) => {
    db.prepare("UPDATE abfrage_teilnehmer SET eingeladen_am = CURRENT_TIMESTAMP WHERE id = ?").run(t.id);
    if (t.benutzer_id) benachrichtige(t.benutzer_id, "jahresabfrage_einladung", { ausschreibungId: req.params.id, token: t.token });
    return { name: t.name, email: t.email, link: `/abfrage/${t.token}` };
  });
  res.json({ anzahl: links.length, links });
});

jahresabfrageRouter.post("/ausschreibungen/:id/erinnern", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  res.json({ anzahlErinnert: erinnereAusstehende(req.params.id) });
});

jahresabfrageRouter.get("/ausschreibungen/:id/fortschritt", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const teilnehmer = db
    .prepare("SELECT id, name, benutzer_id, abgegeben_am FROM abfrage_teilnehmer WHERE ausschreibung_id = ?")
    .all(req.params.id) as any[];
  const mitStatus = teilnehmer.map((t) => {
    const vorgaben = t.benutzer_id ? ladeVorgabenStatus(req.params.id, t.id, t.benutzer_id) : [];
    return {
      id: t.id,
      name: t.name,
      vorgaben: vorgaben.filter((v) => !v.erfuellt),
      vollstaendig: istVollstaendig(vorgaben, t.abgegeben_am),
    };
  });
  const ausstehend = mitStatus.filter((t) => !t.vollstaendig);

  const bloecke = db.prepare("SELECT * FROM schichtblock WHERE ausschreibung_id = ?").all(req.params.id) as any[];
  const engpaesse = bloecke
    .map((b) => {
      const ja = (db.prepare("SELECT COUNT(*) c FROM bewerbung WHERE schichtblock_id = ? AND antwort = 'ja'").get(b.id) as { c: number }).c;
      const wennNoetig = (
        db.prepare("SELECT COUNT(*) c FROM bewerbung WHERE schichtblock_id = ? AND antwort = 'wenn_noetig'").get(b.id) as { c: number }
      ).c;
      const ampel = ja >= b.personen_bedarf ? "ok" : ja + wennNoetig >= b.personen_bedarf ? "knapp" : "eng";
      return { schichtblockId: b.id, bezeichnung: b.bezeichnung, bedarf: b.personen_bedarf, ja, wennNoetig, ampel };
    })
    .filter((e) => e.ampel !== "ok");

  res.json({
    gesamt: teilnehmer.length,
    abgegeben: mitStatus.length - ausstehend.length,
    ausstehend,
    engpaesse,
  });
});

// --- Vergabevorschlag ---

jahresabfrageRouter.post("/ausschreibungen/:id/vergabevorschlag", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  res.json(berechneVergabevorschlag(req.params.id));
});

// --- Export ---

jahresabfrageRouter.get("/ausschreibungen/:id/export.csv", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const raster = baueRaster(req.params.id, { requesterBenutzerId: null, istPlaner: true });
  if (!raster) return res.status(404).json({ error: "Nicht gefunden" });
  const header = ["Name", ...raster.spalten.map((s) => s.bezeichnung)].join(";");
  const zeilen = raster.zeilen.map((z) => [z.name, ...raster.spalten.map((s) => z.zellen[s.schichtblockId]?.antwort ?? "")].join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="jahresabfrage-${req.params.id}.csv"`);
  res.send([header, ...zeilen].join("\r\n"));
});
