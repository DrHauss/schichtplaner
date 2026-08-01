import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { pruefeKonflikte, Konflikt } from "../lib/regelwerk";
import { benachrichtige } from "../lib/notify";
import { istPlanerFuerPlanungseinheit } from "../lib/berechtigung";

export const plantafelRouter = Router();
plantafelRouter.use(requireAuth);

// Plantafel-Daten fuer eine Planungseinheit im Zeitraum laden
plantafelRouter.get("/planungseinheiten/:id/plantafel", (req, res) => {
  const { von, bis } = req.query as { von?: string; bis?: string };
  if (!von || !bis) return res.status(400).json({ error: "von und bis erforderlich" });

  const mitarbeiter = db
    .prepare(
      `SELECT b.id, b.name FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
       WHERE m.planungseinheit_id = ? AND m.rolle IN ('mitarbeiter','planer')`
    )
    .all(req.params.id);

  const zuweisungen = db
    .prepare(
      `SELECT sz.* FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id
       WHERE sa.planungseinheit_id = ? AND sz.datum BETWEEN ? AND ?`
    )
    .all(req.params.id, von, bis);

  const schichtarten = db.prepare("SELECT * FROM schichtart WHERE planungseinheit_id = ?").all(req.params.id);
  const bedarf = db
    .prepare(
      `SELECT bb.* FROM besetzungsbedarf bb JOIN schichtart sa ON sa.id = bb.schichtart_id WHERE sa.planungseinheit_id = ?`
    )
    .all(req.params.id);

  res.json({ mitarbeiter, zuweisungen, schichtarten, bedarf });
});

// Schicht zuweisen (mit Konfliktpruefung)
plantafelRouter.post("/zuweisungen", requirePlaner(), (req: AuthedRequest, res) => {
  const { benutzerId, schichtartId, datum, planungseinheitId, force } = req.body ?? {};
  if (!benutzerId || !schichtartId || !datum) {
    return res.status(400).json({ error: "benutzerId, schichtartId, datum erforderlich" });
  }
  const konflikte = pruefeKonflikte(benutzerId, schichtartId, datum);
  if (konflikte.length > 0 && !force) {
    return res.status(409).json({ error: "Konflikte gefunden", konflikte });
  }
  const info = db
    .prepare(
      `INSERT INTO schicht_zuweisung (benutzer_id, schichtart_id, datum, status, quelle) VALUES (?,?,?,'entwurf','manuell')
       ON CONFLICT(benutzer_id, datum, schichtart_id) DO NOTHING`
    )
    .run(benutzerId, schichtartId, datum);
  res.status(201).json({ id: info.lastInsertRowid, konflikte });
});

plantafelRouter.delete("/zuweisungen/:id", requirePlaner(), (req, res) => {
  db.prepare("DELETE FROM schicht_zuweisung WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Ganzen Schichtblock aus einer Vorlage gezielt zuweisen (z. B. "Wochenende Fruehschicht",
// "Nachtschicht 3er Block") -- direkte Top-down-Zuweisung, unabhaengig von der Schichtboerse.
plantafelRouter.post("/schichtblock-vorlagen/:id/zuweisen", (req: AuthedRequest, res) => {
  const vorlage = db.prepare("SELECT * FROM schichtblock_vorlage WHERE id = ?").get(req.params.id) as
    | { id: number; planungseinheit_id: number }
    | undefined;
  if (!vorlage) return res.status(404).json({ error: "Vorlage nicht gefunden" });
  if (!istPlanerFuerPlanungseinheit(req, vorlage.planungseinheit_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }

  const { benutzerId, startDatum, force } = req.body ?? {};
  if (!benutzerId || !startDatum) return res.status(400).json({ error: "benutzerId und startDatum erforderlich" });

  const eintraege = db
    .prepare("SELECT tag_offset, schichtart_id FROM schichtblock_vorlage_eintrag WHERE vorlage_id = ? ORDER BY tag_offset")
    .all(req.params.id) as { tag_offset: number; schichtart_id: number }[];
  if (eintraege.length === 0) return res.status(400).json({ error: "Vorlage enthaelt keine Eintraege" });

  const geplant = eintraege.map((e) => {
    const d = new Date(`${startDatum}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + e.tag_offset);
    return { datum: d.toISOString().slice(0, 10), schichtartId: e.schichtart_id };
  });

  const konflikte: (Konflikt & { datum: string })[] = [];
  for (const g of geplant) {
    for (const k of pruefeKonflikte(benutzerId, g.schichtartId, g.datum)) {
      konflikte.push({ ...k, datum: g.datum });
    }
  }
  if (konflikte.length > 0 && !force) {
    return res.status(409).json({ error: "Konflikte gefunden", konflikte });
  }

  const insert = db.prepare(
    `INSERT INTO schicht_zuweisung (benutzer_id, schichtart_id, datum, status, quelle) VALUES (?,?,?,'entwurf','manuell')
     ON CONFLICT(benutzer_id, datum, schichtart_id) DO NOTHING`
  );
  const tx = db.transaction(() => {
    for (const g of geplant) insert.run(benutzerId, g.schichtartId, g.datum);
  });
  tx();

  res.status(201).json({ ok: true, anzahlTage: geplant.length, konflikte });
});

// Plan veroeffentlichen: alle Entwuerfe im Zeitraum -> veroeffentlicht, Benachrichtigung an betroffene Mitarbeiter
plantafelRouter.post("/planungseinheiten/:id/veroeffentlichen", requirePlaner("id"), (req, res) => {
  const { von, bis } = req.body ?? {};
  if (!von || !bis) return res.status(400).json({ error: "von und bis erforderlich" });
  const betroffene = db
    .prepare(
      `SELECT DISTINCT sz.benutzer_id FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id
       WHERE sa.planungseinheit_id = ? AND sz.datum BETWEEN ? AND ? AND sz.status = 'entwurf'`
    )
    .all(req.params.id, von, bis) as { benutzer_id: number }[];

  db.prepare(
    `UPDATE schicht_zuweisung SET status = 'veroeffentlicht'
     WHERE id IN (
       SELECT sz.id FROM schicht_zuweisung sz JOIN schichtart sa ON sa.id = sz.schichtart_id
       WHERE sa.planungseinheit_id = ? AND sz.datum BETWEEN ? AND ? AND sz.status = 'entwurf'
     )`
  ).run(req.params.id, von, bis);

  for (const b of betroffene) {
    benachrichtige(b.benutzer_id, "plan_veroeffentlicht", { von, bis });
  }
  res.json({ ok: true, anzahlMitarbeiter: betroffene.length });
});
