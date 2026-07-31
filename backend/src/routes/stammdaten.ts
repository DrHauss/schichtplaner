import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { istPlanerFuerPlanungseinheit } from "../lib/berechtigung";

export const stammdatenRouter = Router();
stammdatenRouter.use(requireAuth);

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

// Schichtarten
stammdatenRouter.get("/planungseinheiten/:id/schichtarten", (req, res) => {
  res.json(db.prepare("SELECT * FROM schichtart WHERE planungseinheit_id = ?").all(req.params.id));
});

stammdatenRouter.post("/planungseinheiten/:id/schichtarten", requirePlaner("id"), (req, res) => {
  const { kuerzel, bezeichnung, farbe, beginn, ende, pauseMin, stundenwert, zuschlagsart, kategorie } = req.body ?? {};
  if (!kuerzel || !bezeichnung || !beginn || !ende) {
    return res.status(400).json({ error: "kuerzel, bezeichnung, beginn, ende erforderlich" });
  }
  if (kategorie && !["dienst", "abwesenheit"].includes(kategorie)) {
    return res.status(400).json({ error: "kategorie muss 'dienst' oder 'abwesenheit' sein" });
  }
  const info = db
    .prepare(
      `INSERT INTO schichtart (planungseinheit_id, kuerzel, bezeichnung, farbe, beginn, ende, pause_min, stundenwert, zuschlagsart, kategorie)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.params.id,
      kuerzel,
      bezeichnung,
      farbe ?? "#3b82f6",
      beginn,
      ende,
      pauseMin ?? 0,
      stundenwert ?? null,
      zuschlagsart ?? null,
      kategorie ?? "dienst"
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

stammdatenRouter.put("/schichtarten/:id", (req: AuthedRequest, res) => {
  const schichtart = db.prepare("SELECT planungseinheit_id FROM schichtart WHERE id = ?").get(req.params.id) as
    | { planungseinheit_id: number }
    | undefined;
  if (!schichtart) return res.status(404).json({ error: "Schichtart nicht gefunden" });
  if (!istPlanerFuerPlanungseinheit(req, schichtart.planungseinheit_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  const { kuerzel, bezeichnung, farbe, beginn, ende, pauseMin, stundenwert, zuschlagsart, kategorie } = req.body ?? {};
  if (!kuerzel || !bezeichnung || !beginn || !ende) {
    return res.status(400).json({ error: "kuerzel, bezeichnung, beginn, ende erforderlich" });
  }
  if (kategorie && !["dienst", "abwesenheit"].includes(kategorie)) {
    return res.status(400).json({ error: "kategorie muss 'dienst' oder 'abwesenheit' sein" });
  }
  db.prepare(
    `UPDATE schichtart SET kuerzel=?, bezeichnung=?, farbe=?, beginn=?, ende=?, pause_min=?, stundenwert=?, zuschlagsart=?, kategorie=? WHERE id=?`
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
    req.params.id
  );
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
        `SELECT e.id, e.tag_offset, e.schichtart_id, sa.kuerzel, sa.bezeichnung as schichtart_bezeichnung
         FROM schichtblock_vorlage_eintrag e JOIN schichtart sa ON sa.id = e.schichtart_id
         WHERE e.vorlage_id = ? ORDER BY e.tag_offset`
      )
      .all(v.id);
    return { ...v, eintraege };
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
