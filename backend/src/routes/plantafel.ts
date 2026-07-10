import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { pruefeKonflikte } from "../lib/regelwerk";
import { benachrichtige } from "../lib/notify";

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
