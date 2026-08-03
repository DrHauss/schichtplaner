import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { pruefeKonflikte, Konflikt } from "../lib/regelwerk";
import { benachrichtige } from "../lib/notify";
import { istPlanerFuerPlanungseinheit, istPlanerFuerMitarbeiter } from "../lib/berechtigung";

export const plantafelRouter = Router();
plantafelRouter.use(requireAuth);

// Schichtarten sind global (siehe lib/db.ts) -- eine Zuweisung "gehoert" damit keiner Planungs-
// einheit mehr direkt, sondern nur noch dem Mitarbeiter. Fuer Rechteentscheidungen wird daher der
// Mitarbeiter der Zuweisung ermittelt (siehe istPlanerFuerMitarbeiter).
function benutzerIdFuerZuweisung(zuweisungId: string | number): number | undefined {
  const row = db.prepare("SELECT benutzer_id FROM schicht_zuweisung WHERE id = ?").get(zuweisungId) as
    | { benutzer_id: number }
    | undefined;
  return row?.benutzer_id;
}

// Plantafel-Daten fuer eine Planungseinheit im Zeitraum laden
plantafelRouter.get("/planungseinheiten/:id/plantafel", (req: AuthedRequest, res) => {
  const { von, bis } = req.query as { von?: string; bis?: string };
  if (!von || !bis) return res.status(400).json({ error: "von und bis erforderlich" });

  const mitarbeiter = db
    .prepare(
      `SELECT b.id, b.name FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
       WHERE m.planungseinheit_id = ? AND m.rolle = 'mitarbeiter'`
    )
    .all(req.params.id) as { id: number; name: string }[];

  // Ein Mitarbeiter kann Mitglied mehrerer Planungseinheiten sein; seine Schicht gilt fuer alle
  // davon (Schichtarten sind global). Die Plantafel zeigt daher ALLE Zuweisungen der Team-
  // Mitglieder im Zeitraum, unabhaengig davon, ueber welches ihrer Teams sie urspruenglich
  // zugewiesen wurden.
  const mitarbeiterIds = mitarbeiter.map((m) => m.id);
  const zuweisungen =
    mitarbeiterIds.length === 0
      ? []
      : db
          .prepare(
            `SELECT * FROM schicht_zuweisung
             WHERE benutzer_id IN (${mitarbeiterIds.map(() => "?").join(",")}) AND datum BETWEEN ? AND ?`
          )
          .all(...mitarbeiterIds, von, bis);

  const schichtarten = db.prepare("SELECT * FROM schichtart").all();
  const bedarf = db.prepare("SELECT * FROM besetzungsbedarf").all();

  // Bereitschaften sind keine Schichten -- eigene, roster-gescopte Liste analog zuweisungen.
  const bereitschaften =
    mitarbeiterIds.length === 0
      ? []
      : db
          .prepare(
            `SELECT * FROM bereitschaft_zuweisung
             WHERE benutzer_id IN (${mitarbeiterIds.map(() => "?").join(",")}) AND datum BETWEEN ? AND ?`
          )
          .all(...mitarbeiterIds, von, bis);
  const bereitschaftsarten = db.prepare("SELECT * FROM bereitschaftsart").all();

  // Kommentare des Zeitraums in einer Query mitladen (kein N+1). Wer kein Planer dieser
  // Planungseinheit ist, sieht die als 'nur_planer' markierten Kommentare nicht.
  const istPlaner = istPlanerFuerPlanungseinheit(req, Number(req.params.id));
  const kommentare = (
    mitarbeiterIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT k.id, k.zuweisung_id, k.autor_id, b.name AS autor_name, k.text, k.sichtbarkeit, k.erstellt_am
             FROM schicht_kommentar k
             JOIN schicht_zuweisung sz ON sz.id = k.zuweisung_id
             JOIN benutzer b ON b.id = k.autor_id
             WHERE sz.benutzer_id IN (${mitarbeiterIds.map(() => "?").join(",")}) AND sz.datum BETWEEN ? AND ?
             ORDER BY k.erstellt_am`
          )
          .all(...mitarbeiterIds, von, bis) as { sichtbarkeit: string }[])
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

  res.json({ mitarbeiter, zuweisungen, schichtarten, bedarf, kommentare, freischichtKommentare, bereitschaften, bereitschaftsarten });
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

// Da Schichtarten global sind, wird die Berechtigung ueber ein gemeinsames Team mit dem
// betroffenen Mitarbeiter geprueft (istPlanerFuerMitarbeiter), nicht mehr ueber die (nicht mehr
// existierende) Planungseinheit der Schichtart. Zugehoerige Kommentare verschwinden per
// ON DELETE CASCADE mit.
// ?kommentareBehalten=1&planungseinheitId=X (vom Radierer genutzt): Kommentare der Zuweisung
// werden vor dem Loeschen in Freischicht-Kommentare der angegebenen Planungseinheit "umgezogen"
// (der Tag wird ja zur Freischicht), statt sie per ON DELETE CASCADE zu verlieren. Das explizite
// "Zuweisung loeschen" im Detailfenster nutzt das Flag bewusst nicht -- dort warnt der
// confirm-Dialog schon vorab ueber den Kommentarverlust.
plantafelRouter.delete("/zuweisungen/:id", (req: AuthedRequest, res) => {
  const zuweisung = db.prepare("SELECT benutzer_id, datum FROM schicht_zuweisung WHERE id = ?").get(req.params.id) as
    | { benutzer_id: number; datum: string }
    | undefined;
  if (!zuweisung) return res.status(404).json({ error: "Zuweisung nicht gefunden" });
  if (!istPlanerFuerMitarbeiter(req, zuweisung.benutzer_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diesen Mitarbeiter" });
  }
  if (req.query.kommentareBehalten === "1" && req.query.planungseinheitId) {
    db.prepare(
      `INSERT INTO freischicht_kommentar (planungseinheit_id, benutzer_id, datum, autor_id, text, sichtbarkeit, erstellt_am)
       SELECT ?, ?, ?, autor_id, text, sichtbarkeit, erstellt_am FROM schicht_kommentar WHERE zuweisung_id = ?`
    ).run(req.query.planungseinheitId, zuweisung.benutzer_id, zuweisung.datum, req.params.id);
  }
  db.prepare("DELETE FROM schicht_zuweisung WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Bereitschaft zuweisen -- keine Konfliktpruefung (keine Schicht, kein ArbZG-Ruhezeitbezug),
// mehrere Bereitschaften am selben Tag sind moeglich (unterschiedliche bereitschaftsart_id) und
// stehen zusaetzlich zu einer normalen Schicht am selben Tag.
plantafelRouter.post("/bereitschaften", requirePlaner(), (req: AuthedRequest, res) => {
  const { benutzerId, bereitschaftsartId, datum } = req.body ?? {};
  if (!benutzerId || !bereitschaftsartId || !datum) {
    return res.status(400).json({ error: "benutzerId, bereitschaftsartId, datum erforderlich" });
  }
  const bereitschaftsart = db.prepare("SELECT archiviert FROM bereitschaftsart WHERE id = ?").get(bereitschaftsartId) as
    | { archiviert: number }
    | undefined;
  if (!bereitschaftsart) return res.status(404).json({ error: "Bereitschaftsart nicht gefunden" });
  if (bereitschaftsart.archiviert) {
    return res.status(400).json({ error: "Bereitschaftsart ist archiviert -- es koennen keine neuen Zuweisungen mehr angelegt werden" });
  }
  const info = db
    .prepare(
      `INSERT INTO bereitschaft_zuweisung (benutzer_id, bereitschaftsart_id, datum, status, quelle) VALUES (?,?,?,'entwurf','manuell')
       ON CONFLICT(benutzer_id, bereitschaftsart_id, datum) DO NOTHING`
    )
    .run(benutzerId, bereitschaftsartId, datum);
  res.status(201).json({ id: info.lastInsertRowid });
});

plantafelRouter.delete("/bereitschaften/:id", (req: AuthedRequest, res) => {
  const bereitschaft = db.prepare("SELECT benutzer_id FROM bereitschaft_zuweisung WHERE id = ?").get(req.params.id) as
    | { benutzer_id: number }
    | undefined;
  if (!bereitschaft) return res.status(404).json({ error: "Bereitschaft nicht gefunden" });
  if (!istPlanerFuerMitarbeiter(req, bereitschaft.benutzer_id)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diesen Mitarbeiter" });
  }
  db.prepare("DELETE FROM bereitschaft_zuweisung WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Kommentare an einer Zuweisung: nur Planer eines mit dem Mitarbeiter geteilten Teams (bzw.
// Admins) duerfen kommentieren; je Kommentar wird entschieden, ob er oeffentlich oder nur fuer
// Planer sichtbar ist.
plantafelRouter.post("/zuweisungen/:id/kommentare", (req: AuthedRequest, res) => {
  const { text, sichtbarkeit } = req.body ?? {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text erforderlich" });
  if (!["oeffentlich", "nur_planer"].includes(sichtbarkeit)) {
    return res.status(400).json({ error: "sichtbarkeit muss 'oeffentlich' oder 'nur_planer' sein" });
  }
  const benutzerId = benutzerIdFuerZuweisung(req.params.id);
  if (!benutzerId) return res.status(404).json({ error: "Zuweisung nicht gefunden" });
  if (!istPlanerFuerMitarbeiter(req, benutzerId)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diesen Mitarbeiter" });
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
  const benutzerId = benutzerIdFuerZuweisung(kommentar.zuweisung_id);
  if (!benutzerId || !istPlanerFuerMitarbeiter(req, benutzerId)) {
    return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diesen Mitarbeiter" });
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

// Plan veroeffentlichen: alle Entwuerfe der Team-Mitglieder im Zeitraum -> veroeffentlicht,
// Benachrichtigung an betroffene Mitarbeiter. Schichtarten sind global, daher wird ueber die
// Mitgliedschaft dieser Planungseinheit gescopt statt ueber die (nicht mehr existierende)
// Planungseinheit der Schichtart.
plantafelRouter.post("/planungseinheiten/:id/veroeffentlichen", requirePlaner("id"), (req, res) => {
  const { von, bis } = req.body ?? {};
  if (!von || !bis) return res.status(400).json({ error: "von und bis erforderlich" });
  const roster = `SELECT benutzer_id FROM mitgliedschaft WHERE planungseinheit_id = ? AND rolle = 'mitarbeiter'`;
  const betroffene = db
    .prepare(
      `SELECT DISTINCT sz.benutzer_id FROM schicht_zuweisung sz
       WHERE sz.benutzer_id IN (${roster}) AND sz.datum BETWEEN ? AND ? AND sz.status = 'entwurf'`
    )
    .all(req.params.id, von, bis) as { benutzer_id: number }[];

  db.prepare(
    `UPDATE schicht_zuweisung SET status = 'veroeffentlicht'
     WHERE benutzer_id IN (${roster}) AND datum BETWEEN ? AND ? AND status = 'entwurf'`
  ).run(req.params.id, von, bis);

  // Bereitschaften werden zusammen mit den Schichten des Teams veroeffentlicht.
  db.prepare(
    `UPDATE bereitschaft_zuweisung SET status = 'veroeffentlicht'
     WHERE benutzer_id IN (${roster}) AND datum BETWEEN ? AND ? AND status = 'entwurf'`
  ).run(req.params.id, von, bis);

  for (const b of betroffene) {
    benachrichtige(b.benutzer_id, "plan_veroeffentlicht", { von, bis });
  }
  res.json({ ok: true, anzahlMitarbeiter: betroffene.length });
});
