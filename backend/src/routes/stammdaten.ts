import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { istPlanerFuerPlanungseinheit, istIrgendeinPlaner } from "../lib/berechtigung";
import { berechneArbeitstage, ladeFeiertage } from "../lib/feiertage";

export const stammdatenRouter = Router();
stammdatenRouter.use(requireAuth);

// Arbeitstage eines Jahres in NRW (Wochentage abzueglich der arbeitsfreien Feiertage) -- Grundlage
// fuer die Jahresarbeitszeit-Berechnung aus der taeglichen Sollarbeitszeit je Mitarbeiter.
stammdatenRouter.get("/arbeitstage", (req, res) => {
  const jahr = Number(req.query.jahr) || new Date().getFullYear();
  res.json(berechneArbeitstage(jahr));
});

// Feiertage eines Jahres: werden beim ersten Zugriff automatisch aus der gesetzlichen NRW-Regel
// generiert, sind danach bearbeitbar (Datum, Bezeichnung, arbeitsfrei ja/nein) und koennen um
// Sonderregelungen (zusaetzliche, manuell angelegte Eintraege) ergaenzt werden.
stammdatenRouter.get("/feiertage", (req, res) => {
  const jahr = Number(req.query.jahr) || new Date().getFullYear();
  res.json(ladeFeiertage(jahr));
});

stammdatenRouter.post("/feiertage", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const { jahr, datum, bezeichnung, istFrei } = req.body ?? {};
  if (!jahr || !datum || !bezeichnung) return res.status(400).json({ error: "jahr, datum und bezeichnung erforderlich" });
  try {
    const info = db
      .prepare("INSERT INTO feiertag (jahr, datum, bezeichnung, ist_frei, quelle) VALUES (?,?,?,?,'manuell')")
      .run(jahr, datum, bezeichnung, istFrei === false ? 0 : 1);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: "Ein Feiertag mit dieser Bezeichnung existiert in diesem Jahr bereits" });
  }
});

stammdatenRouter.put("/feiertage/:id", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const bestehend = db.prepare("SELECT id FROM feiertag WHERE id = ?").get(req.params.id);
  if (!bestehend) return res.status(404).json({ error: "Feiertag nicht gefunden" });
  const { datum, bezeichnung, istFrei } = req.body ?? {};
  if (!datum || !bezeichnung) return res.status(400).json({ error: "datum und bezeichnung erforderlich" });
  db.prepare("UPDATE feiertag SET datum = ?, bezeichnung = ?, ist_frei = ? WHERE id = ?").run(
    datum,
    bezeichnung,
    istFrei === false ? 0 : 1,
    req.params.id
  );
  res.json({ ok: true });
});

stammdatenRouter.delete("/feiertage/:id", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const row = db.prepare("SELECT quelle FROM feiertag WHERE id = ?").get(req.params.id) as { quelle: string } | undefined;
  if (!row) return res.status(404).json({ error: "Feiertag nicht gefunden" });
  if (row.quelle === "manuell") {
    db.prepare("DELETE FROM feiertag WHERE id = ?").run(req.params.id);
  } else {
    // Automatisch generierte Feiertage werden nicht geloescht (sonst wuerden sie beim naechsten
    // Zugriff auf das Jahr erneut generiert), sondern als nicht arbeitsfrei markiert -- so bleibt
    // die Sonderregelung (z. B. "hier kein Feiertag") dauerhaft erhalten.
    db.prepare("UPDATE feiertag SET ist_frei = 0 WHERE id = ?").run(req.params.id);
  }
  res.json({ ok: true });
});

// Planungseinheiten
stammdatenRouter.get("/planungseinheiten", (req: AuthedRequest, res) => {
  const rows = req.user!.istAdmin
    ? db.prepare("SELECT * FROM planungseinheit").all()
    : db
        .prepare(
          `SELECT DISTINCT p.* FROM planungseinheit p
           JOIN mitgliedschaft m ON m.planungseinheit_id = p.id
           WHERE m.benutzer_id = ?`
        )
        .all(req.user!.sub);
  res.json(rows);
});

stammdatenRouter.post("/planungseinheiten", (req: AuthedRequest, res) => {
  if (!req.user!.istAdmin) return res.status(403).json({ error: "Nur Administrator" });
  const { name, standort } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name erforderlich" });
  const info = db.prepare("INSERT INTO planungseinheit (name, standort) VALUES (?,?)").run(name, standort ?? null);
  res.status(201).json({ id: info.lastInsertRowid, name, standort });
});

// Qualifikationen
stammdatenRouter.get("/qualifikationen", (_req, res) => {
  res.json(db.prepare("SELECT * FROM qualifikation").all());
});

stammdatenRouter.post("/qualifikationen", (req: AuthedRequest, res) => {
  if (!req.user!.istAdmin) return res.status(403).json({ error: "Nur Administrator" });
  const { bezeichnung } = req.body ?? {};
  if (!bezeichnung) return res.status(400).json({ error: "bezeichnung erforderlich" });
  const info = db.prepare("INSERT INTO qualifikation (bezeichnung) VALUES (?)").run(bezeichnung);
  res.status(201).json({ id: info.lastInsertRowid, bezeichnung });
});

// Mitarbeiter (Benutzer) je Planungseinheit
stammdatenRouter.get("/planungseinheiten/:id/mitarbeiter", (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id, b.email, b.name, b.personalnr, b.wochenstunden, m.rolle
       FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
       WHERE m.planungseinheit_id = ?`
    )
    .all(req.params.id);
  res.json(rows);
});

stammdatenRouter.post("/planungseinheiten/:id/mitglieder", requirePlaner("id"), (req, res) => {
  const { benutzerId, rolle } = req.body ?? {};
  if (!benutzerId || !rolle) return res.status(400).json({ error: "benutzerId und rolle erforderlich" });
  db.prepare("INSERT OR IGNORE INTO mitgliedschaft (benutzer_id, planungseinheit_id, rolle) VALUES (?,?,?)").run(
    benutzerId,
    req.params.id,
    rolle
  );
  res.status(201).json({ ok: true });
});

stammdatenRouter.delete("/planungseinheiten/:id/mitglieder/:mitgliedschaftId", requirePlaner("id"), (req, res) => {
  db.prepare("DELETE FROM mitgliedschaft WHERE id = ? AND planungseinheit_id = ?").run(req.params.mitgliedschaftId, req.params.id);
  res.json({ ok: true });
});

// Schichtarten gelten global fuer alle Planungseinheiten (siehe lib/db.ts) -- Verwaltung daher
// ohne Planungseinheiten-Bezug in der URL; Planer-Berechtigung in irgendeiner Einheit genuegt.
stammdatenRouter.get("/schichtarten", (_req, res) => {
  res.json(db.prepare("SELECT * FROM schichtart").all());
});

stammdatenRouter.post("/schichtarten", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const { kuerzel, bezeichnung, farbe, pauseMin, stundenwert, zuschlagsart, kategorie, ganztags } = req.body ?? {};
  // Ganztaegige Schichtarten (typischerweise Abwesenheiten) haben keine sinnvolle Uhrzeit --
  // beginn/ende werden serverseitig auf den Sentinel "00:00" erzwungen, unabhaengig vom Client.
  const istGanztags = !!ganztags;
  const beginn = istGanztags ? "00:00" : req.body?.beginn;
  const ende = istGanztags ? "00:00" : req.body?.ende;
  if (!kuerzel || !bezeichnung || (!istGanztags && (!beginn || !ende))) {
    return res.status(400).json({ error: "kuerzel, bezeichnung erforderlich; beginn/ende ausser bei ganztags" });
  }
  if (kategorie && !["dienst", "abwesenheit"].includes(kategorie)) {
    return res.status(400).json({ error: "kategorie muss 'dienst' oder 'abwesenheit' sein" });
  }
  const info = db
    .prepare(
      `INSERT INTO schichtart (kuerzel, bezeichnung, farbe, beginn, ende, pause_min, stundenwert, zuschlagsart, kategorie, ganztags)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      kuerzel,
      bezeichnung,
      farbe ?? "#3b82f6",
      beginn,
      ende,
      pauseMin ?? 0,
      stundenwert ?? null,
      zuschlagsart ?? null,
      kategorie ?? "dienst",
      istGanztags ? 1 : 0
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

stammdatenRouter.put("/schichtarten/:id", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const schichtart = db.prepare("SELECT id FROM schichtart WHERE id = ?").get(req.params.id);
  if (!schichtart) return res.status(404).json({ error: "Schichtart nicht gefunden" });
  const { kuerzel, bezeichnung, farbe, pauseMin, stundenwert, zuschlagsart, kategorie, ganztags } = req.body ?? {};
  const istGanztags = !!ganztags;
  const beginn = istGanztags ? "00:00" : req.body?.beginn;
  const ende = istGanztags ? "00:00" : req.body?.ende;
  if (!kuerzel || !bezeichnung || (!istGanztags && (!beginn || !ende))) {
    return res.status(400).json({ error: "kuerzel, bezeichnung erforderlich; beginn/ende ausser bei ganztags" });
  }
  if (kategorie && !["dienst", "abwesenheit"].includes(kategorie)) {
    return res.status(400).json({ error: "kategorie muss 'dienst' oder 'abwesenheit' sein" });
  }
  db.prepare(
    `UPDATE schichtart SET kuerzel=?, bezeichnung=?, farbe=?, beginn=?, ende=?, pause_min=?, stundenwert=?, zuschlagsart=?, kategorie=?, ganztags=? WHERE id=?`
  ).run(
    kuerzel,
    bezeichnung,
    farbe ?? "#3b82f6",
    beginn,
    ende,
    pauseMin ?? 0,
    stundenwert ?? null,
    zuschlagsart ?? null,
    kategorie ?? "dienst",
    istGanztags ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});

// Archivieren/Reaktivieren: archivierte Schichtarten bleiben in bestehenden Zuweisungen und der
// Planung sichtbar, koennen aber nicht mehr neu zugewiesen werden (siehe Sperre in plantafel.ts).
stammdatenRouter.put("/schichtarten/:id/archivieren", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const schichtart = db.prepare("SELECT id FROM schichtart WHERE id = ?").get(req.params.id);
  if (!schichtart) return res.status(404).json({ error: "Schichtart nicht gefunden" });
  const { archiviert } = req.body ?? {};
  db.prepare("UPDATE schichtart SET archiviert = ? WHERE id = ?").run(archiviert ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Bereitschaftsarten (On-Call-Dienste) sind wie Schichtarten global -- Verwaltung ohne
// Planungseinheiten-Bezug, Planer-Berechtigung in irgendeiner Einheit genuegt.
stammdatenRouter.get("/bereitschaftsarten", (_req, res) => {
  res.json(db.prepare("SELECT * FROM bereitschaftsart").all());
});

stammdatenRouter.post("/bereitschaftsarten", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const { kuerzel, bezeichnung, farbe } = req.body ?? {};
  if (!kuerzel || !bezeichnung) return res.status(400).json({ error: "kuerzel und bezeichnung erforderlich" });
  const info = db
    .prepare("INSERT INTO bereitschaftsart (kuerzel, bezeichnung, farbe) VALUES (?,?,?)")
    .run(kuerzel, bezeichnung, farbe ?? "#a855f7");
  res.status(201).json({ id: info.lastInsertRowid });
});

stammdatenRouter.put("/bereitschaftsarten/:id", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const bereitschaftsart = db.prepare("SELECT id FROM bereitschaftsart WHERE id = ?").get(req.params.id);
  if (!bereitschaftsart) return res.status(404).json({ error: "Bereitschaftsart nicht gefunden" });
  const { kuerzel, bezeichnung, farbe } = req.body ?? {};
  if (!kuerzel || !bezeichnung) return res.status(400).json({ error: "kuerzel und bezeichnung erforderlich" });
  db.prepare("UPDATE bereitschaftsart SET kuerzel=?, bezeichnung=?, farbe=? WHERE id=?").run(
    kuerzel,
    bezeichnung,
    farbe ?? "#a855f7",
    req.params.id
  );
  res.json({ ok: true });
});

// Archivieren/Reaktivieren: analog zu Schichtarten -- archivierte Bereitschaftsarten bleiben in
// bestehenden Zuweisungen sichtbar, koennen aber nicht mehr neu zugewiesen werden.
stammdatenRouter.put("/bereitschaftsarten/:id/archivieren", (req: AuthedRequest, res) => {
  if (!istIrgendeinPlaner(req)) return res.status(403).json({ error: "Keine Planer-Berechtigung" });
  const bereitschaftsart = db.prepare("SELECT id FROM bereitschaftsart WHERE id = ?").get(req.params.id);
  if (!bereitschaftsart) return res.status(404).json({ error: "Bereitschaftsart nicht gefunden" });
  const { archiviert } = req.body ?? {};
  db.prepare("UPDATE bereitschaftsart SET archiviert = ? WHERE id = ?").run(archiviert ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Schichtblock-Vorlagen: wiederverwendbare Muster (z. B. "Wochenende Fruehschicht", "Nachtschicht
// 3er Block") fuer die direkte Top-down-Zuweisung in der Plantafel (siehe routes/plantafel.ts).
stammdatenRouter.get("/planungseinheiten/:id/schichtblock-vorlagen", (req, res) => {
  const vorlagen = db
    .prepare("SELECT * FROM schichtblock_vorlage WHERE planungseinheit_id = ? ORDER BY bezeichnung")
    .all(req.params.id) as any[];
  const mitEintraegen = vorlagen.map((v) => {
    const eintraege = db
      .prepare(
        `SELECT e.id, e.tag_offset, e.schichtart_id, sa.kuerzel, sa.bezeichnung as schichtart_bezeichnung, sa.archiviert
         FROM schichtblock_vorlage_eintrag e JOIN schichtart sa ON sa.id = e.schichtart_id
         WHERE e.vorlage_id = ? ORDER BY e.tag_offset`
      )
      .all(v.id) as { archiviert: number }[];
    return { ...v, eintraege, enthaeltArchivierte: eintraege.some((e) => e.archiviert) };
  });
  res.json(mitEintraegen);
});

stammdatenRouter.post("/planungseinheiten/:id/schichtblock-vorlagen", requirePlaner("id"), (req, res) => {
  const { bezeichnung, eintraege } = (req.body ?? {}) as {
    bezeichnung: string;
    eintraege: { tagOffset: number; schichtartId: number }[];
  };
  if (!bezeichnung || !Array.isArray(eintraege) || eintraege.length === 0) {
    return res.status(400).json({ error: "bezeichnung und eintraege[] erforderlich" });
  }
  const ergebnis = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO schichtblock_vorlage (planungseinheit_id, bezeichnung) VALUES (?,?)")
      .run(req.params.id, bezeichnung);
    const vorlageId = info.lastInsertRowid;
    const insertEintrag = db.prepare("INSERT INTO schichtblock_vorlage_eintrag (vorlage_id, tag_offset, schichtart_id) VALUES (?,?,?)");
    for (const e of eintraege) insertEintrag.run(vorlageId, e.tagOffset, e.schichtartId);
    return vorlageId;
  })();
  res.status(201).json({ id: ergebnis });
});

stammdatenRouter.delete("/schichtblock-vorlagen/:id", (req: AuthedRequest, res) => {
  const vorlage = db.prepare("SELECT planungseinheit_id FROM schichtblock_vorlage WHERE id = ?").get(req.params.id) as
    | { planungseinheit_id: number }
    | undefined;
  if (!vorlage) return res.status(404).json({ error: "Vorlage nicht gefunden" });
  if (!istPlanerFuerPlanungseinheit(req, vorlage.planungseinheit_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  db.prepare("DELETE FROM schichtblock_vorlage WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Besetzungsbedarf
stammdatenRouter.get("/schichtarten/:id/bedarf", (req, res) => {
  res.json(db.prepare("SELECT * FROM besetzungsbedarf WHERE schichtart_id = ?").all(req.params.id));
});

stammdatenRouter.post("/schichtarten/:id/bedarf", (req, res) => {
  const { wochentag, sollAnzahl, qualifikationId } = req.body ?? {};
  if (wochentag === undefined || sollAnzahl === undefined) {
    return res.status(400).json({ error: "wochentag und sollAnzahl erforderlich" });
  }
  const info = db
    .prepare("INSERT INTO besetzungsbedarf (schichtart_id, wochentag, soll_anzahl, qualifikation_id) VALUES (?,?,?,?)")
    .run(req.params.id, wochentag, sollAnzahl, qualifikationId ?? null);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Abwesenheiten
stammdatenRouter.get("/abwesenheiten", (req: AuthedRequest, res) => {
  const benutzerId = req.query.benutzerId ? Number(req.query.benutzerId) : req.user!.sub;
  res.json(db.prepare("SELECT * FROM abwesenheit WHERE benutzer_id = ? ORDER BY von DESC").all(benutzerId));
});

stammdatenRouter.post("/abwesenheiten", (req: AuthedRequest, res) => {
  const { typ, von, bis } = req.body ?? {};
  if (!typ || !von || !bis) return res.status(400).json({ error: "typ, von, bis erforderlich" });
  const info = db
    .prepare("INSERT INTO abwesenheit (benutzer_id, typ, von, bis) VALUES (?,?,?,?)")
    .run(req.user!.sub, typ, von, bis);
  res.status(201).json({ id: info.lastInsertRowid });
});

stammdatenRouter.post("/abwesenheiten/:id/entscheiden", (req: AuthedRequest, res) => {
  const { status } = req.body ?? {};
  if (!["genehmigt", "abgelehnt"].includes(status)) return res.status(400).json({ error: "status ungueltig" });
  db.prepare("UPDATE abwesenheit SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});
