import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const uebersichtRouter = Router();
uebersichtRouter.use(requireAuth);

// Teamuebergreifende Uebersicht der veroeffentlichten Schichten: fuer jeden angemeldeten Nutzer
// sichtbar, unabhaengig von der eigenen Mitgliedschaft -- Entwuerfe bleiben bewusst nur fuer die
// Planer der jeweiligen Planungseinheit sichtbar (Plantafel), hier zaehlt nur der veroeffentlichte
// Stand.
uebersichtRouter.get("/", (req: AuthedRequest, res) => {
  const { von, bis } = req.query as { von?: string; bis?: string };
  if (!von || !bis) return res.status(400).json({ error: "von und bis erforderlich" });

  // Schichtarten sind global -- eine Zuweisung erscheint daher unter JEDER Planungseinheit, in
  // der der Mitarbeiter Mitglied ist (nicht mehr nur unter der PE der Schichtart, die es so nicht
  // mehr gibt). Das ist genau das gewuenschte Verhalten fuer Mitarbeiter in mehreren Teams: ihre
  // Schicht gilt fuer alle ihre Teams gleichermassen.
  const zeilen = db
    .prepare(
      `SELECT p.id as pe_id, p.name as pe_name, p.standort,
              sz.id as zuweisung_id, sz.datum, sz.benutzer_id, b.name as mitarbeiter_name,
              sa.id as schichtart_id, sa.kuerzel, sa.bezeichnung, sa.farbe, sa.beginn, sa.ende, sa.ganztags
       FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id
       JOIN benutzer b ON b.id = sz.benutzer_id
       JOIN mitgliedschaft m ON m.benutzer_id = sz.benutzer_id AND m.rolle IN ('mitarbeiter','planer')
       JOIN planungseinheit p ON p.id = m.planungseinheit_id
       WHERE sz.status = 'veroeffentlicht' AND sz.datum BETWEEN ? AND ?
       ORDER BY p.name, b.name, sz.datum`
    )
    .all(von, bis) as any[];

  // Kommentare der veroeffentlichten Schichten im Zeitraum. 'nur_planer' sieht nur, wer Planer
  // eines mit dem betroffenen Mitarbeiter geteilten Teams ist (oder Admin) -- konsistent zur
  // Plantafel-Route (istPlanerFuerMitarbeiter), da Schichtarten keiner PE mehr direkt zugeordnet sind.
  const mitarbeiterAlsPlanerSichtbar = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT m2.benutzer_id FROM mitgliedschaft m1 JOIN mitgliedschaft m2 ON m1.planungseinheit_id = m2.planungseinheit_id
           WHERE m1.benutzer_id = ? AND m1.rolle = 'planer'`
        )
        .all(req.user!.sub) as { benutzer_id: number }[]
    ).map((m) => m.benutzer_id)
  );
  const kommentarZeilen = db
    .prepare(
      `SELECT k.id, k.zuweisung_id, sz.benutzer_id, b.name AS autor_name, k.text, k.sichtbarkeit, k.erstellt_am
       FROM schicht_kommentar k
       JOIN schicht_zuweisung sz ON sz.id = k.zuweisung_id
       JOIN benutzer b ON b.id = k.autor_id
       WHERE sz.status = 'veroeffentlicht' AND sz.datum BETWEEN ? AND ?
       ORDER BY k.erstellt_am`
    )
    .all(von, bis) as any[];

  const kommentareNachZuweisung = new Map<number, any[]>();
  for (const k of kommentarZeilen) {
    if (k.sichtbarkeit !== "oeffentlich" && !req.user!.istAdmin && !mitarbeiterAlsPlanerSichtbar.has(k.benutzer_id)) continue;
    if (!kommentareNachZuweisung.has(k.zuweisung_id)) kommentareNachZuweisung.set(k.zuweisung_id, []);
    kommentareNachZuweisung.get(k.zuweisung_id)!.push({
      id: k.id,
      autorName: k.autor_name,
      text: k.text,
      sichtbarkeit: k.sichtbarkeit,
      erstelltAm: k.erstellt_am,
    });
  }

  // Kommentare an Freischichten (Tagen ohne Zuweisung) im Zeitraum. Diese haengen (anders als
  // Kommentare an echten Zuweisungen) weiterhin direkt an einer konkreten Planungseinheit --
  // Sichtbarkeit von 'nur_planer' richtet sich daher nach der Planer-Rolle in genau dieser PE.
  const planerPeIds = new Set(
    (
      db
        .prepare("SELECT planungseinheit_id FROM mitgliedschaft WHERE benutzer_id = ? AND rolle = 'planer'")
        .all(req.user!.sub) as { planungseinheit_id: number }[]
    ).map((m) => m.planungseinheit_id)
  );
  const freischichtZeilen = db
    .prepare(
      `SELECT fk.id, fk.planungseinheit_id AS pe_id, fk.benutzer_id, fk.datum, b.name AS autor_name,
              fk.text, fk.sichtbarkeit, fk.erstellt_am
       FROM freischicht_kommentar fk JOIN benutzer b ON b.id = fk.autor_id
       WHERE fk.datum BETWEEN ? AND ?
       ORDER BY fk.erstellt_am`
    )
    .all(von, bis) as any[];

  const freischichtNachPe = new Map<number, any[]>();
  for (const k of freischichtZeilen) {
    if (k.sichtbarkeit !== "oeffentlich" && !req.user!.istAdmin && !planerPeIds.has(k.pe_id)) continue;
    if (!freischichtNachPe.has(k.pe_id)) freischichtNachPe.set(k.pe_id, []);
    freischichtNachPe.get(k.pe_id)!.push({
      id: k.id,
      benutzerId: k.benutzer_id,
      datum: k.datum,
      autorName: k.autor_name,
      text: k.text,
      sichtbarkeit: k.sichtbarkeit,
      erstelltAm: k.erstellt_am,
    });
  }

  const zuweisungenNachPe = new Map<number, any[]>();
  for (const z of zeilen) {
    if (!zuweisungenNachPe.has(z.pe_id)) zuweisungenNachPe.set(z.pe_id, []);
    zuweisungenNachPe.get(z.pe_id)!.push({
      id: z.zuweisung_id,
      datum: z.datum,
      benutzerId: z.benutzer_id,
      mitarbeiterName: z.mitarbeiter_name,
      schichtartId: z.schichtart_id,
      kuerzel: z.kuerzel,
      bezeichnung: z.bezeichnung,
      farbe: z.farbe,
      beginn: z.beginn,
      ende: z.ende,
      ganztags: !!z.ganztags,
      kommentare: kommentareNachZuweisung.get(z.zuweisung_id) ?? [],
    });
  }

  // Alle Planungseinheiten auflisten, auch ohne veroeffentlichte Schichten im Zeitraum, damit
  // die Uebersicht vollstaendig bleibt (z. B. "diese Woche nichts veroeffentlicht").
  const alle = db.prepare("SELECT id, name, standort FROM planungseinheit ORDER BY name").all() as {
    id: number;
    name: string;
    standort: string | null;
  }[];

  res.json({
    planungseinheiten: alle.map((p) => ({
      ...p,
      // Vollstaendiges Team, nicht nur Personen mit Zuweisung -- sonst fehlen Mitarbeiter ohne
      // veroeffentlichte Schicht komplett und ihre Tage koennten nicht als "Freischicht" gezeigt werden.
      mitarbeiter: db
        .prepare(
          `SELECT b.id, b.name FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
           WHERE m.planungseinheit_id = ? AND m.rolle IN ('mitarbeiter','planer') ORDER BY b.name`
        )
        .all(p.id),
      zuweisungen: zuweisungenNachPe.get(p.id) ?? [],
      freischichtKommentare: freischichtNachPe.get(p.id) ?? [],
    })),
  });
});
