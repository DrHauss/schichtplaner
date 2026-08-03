import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const meinRouter = Router();
meinRouter.use(requireAuth);

meinRouter.get("/plan", (req: AuthedRequest, res) => {
  const { von, bis } = req.query as { von?: string; bis?: string };
  const params: unknown[] = [req.user!.sub];
  let sql = `SELECT sz.*, sa.kuerzel, sa.bezeichnung, sa.farbe, sa.beginn, sa.ende, sa.ganztags
             FROM schicht_zuweisung sz JOIN schichtart sa ON sa.id = sz.schichtart_id
             WHERE sz.benutzer_id = ? AND sz.status = 'veroeffentlicht'`;
  if (von && bis) {
    sql += " AND sz.datum BETWEEN ? AND ?";
    params.push(von, bis);
  }
  sql += " ORDER BY sz.datum ASC";
  const eintraege = db.prepare(sql).all(...params) as { id: number }[];

  // Nur oeffentliche Kommentare -- 'nur_planer' bleibt der Plantafel vorbehalten.
  const kommentare = db
    .prepare(
      `SELECT k.zuweisung_id, b.name AS autor_name, k.text, k.erstellt_am
       FROM schicht_kommentar k
       JOIN schicht_zuweisung sz ON sz.id = k.zuweisung_id
       JOIN benutzer b ON b.id = k.autor_id
       WHERE k.sichtbarkeit = 'oeffentlich' AND sz.benutzer_id = ? AND sz.status = 'veroeffentlicht'
       ORDER BY k.erstellt_am`
    )
    .all(req.user!.sub) as { zuweisung_id: number; autor_name: string; text: string; erstellt_am: string }[];

  const nachZuweisung = new Map<number, { autorName: string; text: string; erstelltAm: string }[]>();
  for (const k of kommentare) {
    if (!nachZuweisung.has(k.zuweisung_id)) nachZuweisung.set(k.zuweisung_id, []);
    nachZuweisung.get(k.zuweisung_id)!.push({ autorName: k.autor_name, text: k.text, erstelltAm: k.erstellt_am });
  }

  res.json(eintraege.map((e) => ({ ...e, kommentare: nachZuweisung.get(e.id) ?? [] })));
});

// iCal-Feed je Mitarbeiter (Abo im privaten Kalender)
meinRouter.get("/plan.ics", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT sz.datum, sa.bezeichnung, sa.beginn, sa.ende, sa.ganztags FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id
       WHERE sz.benutzer_id = ? AND sz.status = 'veroeffentlicht' ORDER BY sz.datum`
    )
    .all(req.user!.sub) as { datum: string; bezeichnung: string; beginn: string; ende: string; ganztags: number }[];

  const fmt = (d: string, t: string) => `${d.replace(/-/g, "")}T${t.replace(":", "")}00`;
  const alsDatumZiffern = (d: string) => d.replace(/-/g, "");
  // iCal-Ende bei Ganztags-Terminen ist exklusiv -- DTEND muss daher auf den Folgetag zeigen.
  const naechsterTag = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return alsDatumZiffern(dt.toISOString().slice(0, 10));
  };

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SchichtWeb//DE",
    ...rows.map((r) =>
      [
        "BEGIN:VEVENT",
        `UID:${r.datum}-${r.bezeichnung}-${req.user!.sub}@schichtweb`,
        r.ganztags
          ? `DTSTART;VALUE=DATE:${alsDatumZiffern(r.datum)}`
          : `DTSTART:${fmt(r.datum, r.beginn)}`,
        r.ganztags ? `DTEND;VALUE=DATE:${naechsterTag(r.datum)}` : `DTEND:${fmt(r.datum, r.ende)}`,
        `SUMMARY:${r.bezeichnung}`,
        "END:VEVENT",
      ].join("\r\n")
    ),
    "END:VCALENDAR",
  ];
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(lines.join("\r\n"));
});
