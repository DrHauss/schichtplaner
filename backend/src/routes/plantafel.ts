import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { pruefeKonflikte, Konflikt } from "../lib/regelwerk";
import { benachrichtige } from "../lib/notify";
import { istPlanerFuerPlanungseinheit } from "../lib/berechtigung";

export const plantafelRouter = Router();
plantafelRouter.use(requireAuth);

// Die Planungseinheit einer Zuweisung haengt an deren Schichtart -- noetig, um die
// Planer-Berechtigung zu pruefen, ohne dass der Client sie mitschicken muss.
function peIdFuerZuweisung(zuweisungId: string | number): number | undefined {
  const row = db
    .prepare(
      `SELECT sa.planungseinheit_id FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id WHERE sz.id = ?`
    )
    .get(zuweisungId) as { planungseinheit_id: number } | undefined;
  return row?.planungseinheit_id;
}

// Plantafel-Daten fuer eine Planungseinheit im Zeitraum laden
plantafelRouter.get("/planungseinheiten/:id/plantafel", (req: AuthedRequest, res) => {
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

  // Kommentare des Zeitraums in einer Query mitladen (kein N+1). Wer kein Planer dieser
  // Planungseinheit ist, sieht die als 'nur_planer' markierten Kommentare nicht.
  const istPlaner = istPlanerFuerPlanungseinheit(req, Number(req.params.id));
  const kommentare = (
    db
      .prepare(
        `SELECT k.id, k.zuweisung_id, k.autor_id, b.name AS autor_name, k.text, k.sichtbarkeit, k.erstellt_am
         FROM schicht_kommentar k
         JOIN schicht_zuweisung sz ON sz.id = k.zuweisung_id
         JOIN schichtart sa ON sa.id = sz.schichtart_id
         JOIN benutzer b ON b.id = k.autor_id
         WHERE sa.planungseinheit_id = ? AND sz.datum BETWEEN ? AND ?
         ORDER BY k.erstellt_am`
      )
      .all(req.params.id, von, bis) as { sichtbarkeit: string }[]
  ).filter((k) => istPlaner || k.sichtbarkeit === "oeffentlich");

  const freischichtKommentare = (
    db
      .prepare(
        `SELECT fk.id, fk.benutzer_id, fk.datum, fk.autor_id, b.name AS autor_name, fk.text, fk.sichtbarkeit, fk.erstellt_am
         FROM freischicht_kommentar fk JOIN benutzer b ON b.id = fk.autor_id
         WHERE fk.planungseinheit_id = ? AND fk.datum BETWEEN ? AND ?
         ORDER BY fk.erstellt_am`
      )
      .all(req.params.id, von, bis) as { sichtbarkeit: string }[]
  ).filter((k) => istPlaner || k.sichtbarkeit === "oeffentlich");

  res.json({ mitarbeiter, zuweisungen, schichtarten, bedarf, kommentare, freischichtKommentare });
});

// Schicht zuweisen (mit Konfliktpruefung)
plantafelRouter.post("/zuweisungen", requirePlaner(), (req: AuthedRequest, res) => {
  const { benutzerId, schichtartId, datum, planungseinheitId, force } = req.body ?? {};
  if (!benutzerId || !schichtartId || !datum) {
    return res.status(400).json({ error: "benutzerId, schichtartId, datum erforderlich" });
  }
  const schichtart = db.prepare("SELECT archiviert FROM schichtart WHERE id = ?").get(schichtartId) as
    | { archiviert: number }
    | undefined;
  if (!schichtart) return res.status(404).json({ error: "Schichtart nicht gefunden" });
  if (schichtart.archiviert) {
    return res.status(400).json({ error: "Schichtart ist archiviert -- es koennen keine neuen Zuweisungen mehr angelegt werden" });
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

// Die Planungseinheit wird aus der Zuweisung selbst abgeleitet -- requirePlaner() koennte sie
// hier nicht ermitteln, da beim DELETE weder Body noch Query eine planungseinheitId enthalten.
// Zugehoerige Kommentare verschwinden per ON DELETE CASCADE mit.
// ?kommentareBehalten=1 (vom Radierer genutzt): Kommentare der Zuweisung werden vor dem Loeschen
// in Freischicht-Kommentare "umgezogen" (der Tag wird ja zur Freischicht), statt sie per
// ON DELETE CASCADE zu verlieren. Das explizite "Zuweisung loeschen" im Detailfenster nutzt das
// Flag bewusst nicht -- dort warnt der confirm-Dialog schon vorab ueber den Kommentarverlust.
plantafelRouter.delete("/zuweisungen/:id", (req: AuthedRequest, res) => {
  const zuweisung = db
    .prepare(
      `SELECT sz.benutzer_id, sz.datum, sa.planungseinheit_id FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id WHERE sz.id = ?`
    )
    .get(req.params.id) as { benutzer_id: number; datum: string; planungseinheit_id: number } | undefined;
  if (!zuweisung) return res.status(404).json({ error: "Zuweisung nicht gefunden" });
  if (!istPlanerFuerPlanungseinheit(req, zuweisung.planungseinheit_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  if (req.query.kommentareBehalten === "1") {
    db.prepare(
      `INSERT INTO freischicht_kommentar (planungseinheit_id, benutzer_id, datum, autor_id, text, sichtbarkeit, erstellt_am)
       SELECT ?, ?, ?, autor_id, text, sichtbarkeit, erstellt_am FROM schicht_kommentar WHERE zuweisung_id = ?`
    ).run(zuweisung.planungseinheit_id, zuweisung.benutzer_id, zuweisung.datum, req.params.id);
  }
  db.prepare("DELETE FROM schicht_zuweisung WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Kommentare an einer Zuweisung: nur Planer der Planungseinheit (bzw. Admins) duerfen
// kommentieren; je Kommentar wird entschieden, ob er oeffentlich oder nur fuer Planer sichtbar ist.
plantafelRouter.post("/zuweisungen/:id/kommentare", (req: AuthedRequest, res) => {
  const { text, sichtbarkeit } = req.body ?? {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text erforderlich" });
  if (!["oeffentlich", "nur_planer"].includes(sichtbarkeit)) {
    return res.status(400).json({ error: "sichtbarkeit muss 'oeffentlich' oder 'nur_planer' sein" });
  }
  const peId = peIdFuerZuweisung(req.params.id);
  if (!peId) return res.status(404).json({ error: "Zuweisung nicht gefunden" });
  if (!istPlanerFuerPlanungseinheit(req, peId)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  const info = db
    .prepare("INSERT INTO schicht_kommentar (zuweisung_id, autor_id, text, sichtbarkeit) VALUES (?,?,?,?)")
    .run(req.params.id, req.user!.sub, String(text).trim(), sichtbarkeit);
  const kommentar = db
    .prepare(
      `SELECT k.id, k.zuweisung_id, k.autor_id, b.name AS autor_name, k.text, k.sichtbarkeit, k.erstellt_am
       FROM schicht_kommentar k JOIN benutzer b ON b.id = k.autor_id WHERE k.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(kommentar);
});

plantafelRouter.delete("/kommentare/:id", (req: AuthedRequest, res) => {
  const kommentar = db.prepare("SELECT zuweisung_id FROM schicht_kommentar WHERE id = ?").get(req.params.id) as
    | { zuweisung_id: number }
    | undefined;
  if (!kommentar) return res.status(404).json({ error: "Kommentar nicht gefunden" });
  const peId = peIdFuerZuweisung(kommentar.zuweisung_id);
  if (!peId || !istPlanerFuerPlanungseinheit(req, peId)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  db.prepare("DELETE FROM schicht_kommentar WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Kommentare an Freischichten (Tage ohne Zuweisung): Adresse ist (benutzerId, datum,
// planungseinheitId) statt einer zuweisung_id -- gleiche Rechte-/Sichtbarkeitslogik wie bei
// Kommentaren an echten Zuweisungen.
plantafelRouter.post("/freischicht-kommentare", (req: AuthedRequest, res) => {
  const { benutzerId, datum, planungseinheitId, text, sichtbarkeit } = req.body ?? {};
  if (!benutzerId || !datum || !planungseinheitId) {
    return res.status(400).json({ error: "benutzerId, datum, planungseinheitId erforderlich" });
  }
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text erforderlich" });
  if (!["oeffentlich", "nur_planer"].includes(sichtbarkeit)) {
    return res.status(400).json({ error: "sichtbarkeit muss 'oeffentlich' oder 'nur_planer' sein" });
  }
  if (!istPlanerFuerPlanungseinheit(req, planungseinheitId)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  const info = db
    .prepare(
      "INSERT INTO freischicht_kommentar (planungseinheit_id, benutzer_id, datum, autor_id, text, sichtbarkeit) VALUES (?,?,?,?,?,?)"
    )
    .run(planungseinheitId, benutzerId, datum, req.user!.sub, String(text).trim(), sichtbarkeit);
  const kommentar = db
    .prepare(
      `SELECT fk.id, fk.benutzer_id, fk.datum, fk.autor_id, b.name AS autor_name, fk.text, fk.sichtbarkeit, fk.erstellt_am
       FROM freischicht_kommentar fk JOIN benutzer b ON b.id = fk.autor_id WHERE fk.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(kommentar);
});

plantafelRouter.delete("/freischicht-kommentare/:id", (req: AuthedRequest, res) => {
  const kommentar = db.prepare("SELECT planungseinheit_id FROM freischicht_kommentar WHERE id = ?").get(req.params.id) as
    | { planungseinheit_id: number }
    | undefined;
  if (!kommentar) return res.status(404).json({ error: "Kommentar nicht gefunden" });
  if (!istPlanerFuerPlanungseinheit(req, kommentar.planungseinheit_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
  }
  db.prepare("DELETE FROM freischicht_kommentar WHERE id = ?").run(req.params.id);
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
    .prepare(
      `SELECT e.tag_offset, e.schichtart_id, sa.archiviert FROM schichtblock_vorlage_eintrag e
       JOIN schichtart sa ON sa.id = e.schichtart_id WHERE e.vorlage_id = ? ORDER BY e.tag_offset`
    )
    .all(req.params.id) as { tag_offset: number; schichtart_id: number; archiviert: number }[];
  if (eintraege.length === 0) return res.status(400).json({ error: "Vorlage enthaelt keine Eintraege" });
  if (eintraege.some((e) => e.archiviert)) {
    return res
      .status(400)
      .json({ error: "Vorlage enthaelt eine archivierte Schichtart -- es koennen keine neuen Zuweisungen mehr angelegt werden" });
  }

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
