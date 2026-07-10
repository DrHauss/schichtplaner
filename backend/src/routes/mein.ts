import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const meinRouter = Router();
meinRouter.use(requireAuth);

meinRouter.get("/plan", (req: AuthedRequest, res) => {
  const { von, bis } = req.query as { von?: string; bis?: string };
  const params: unknown[] = [req.user!.sub];
  let sql = `SELECT sz.*, sa.kuerzel, sa.bezeichnung, sa.farbe, sa.beginn, sa.ende
             FROM schicht_zuweisung sz JOIN schichtart sa ON sa.id = sz.schichtart_id
             WHERE sz.benutzer_id = ? AND sz.status = 'veroeffentlicht'`;
  if (von && bis) {
    sql += " AND sz.datum BETWEEN ? AND ?";
    params.push(von, bis);
  }
  sql += " ORDER BY sz.datum ASC";
  res.json(db.prepare(sql).all(...params));
});

// iCal-Feed je Mitarbeiter (Abo im privaten Kalender)
meinRouter.get("/plan.ics", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT sz.datum, sa.bezeichnung, sa.beginn, sa.ende FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id
       WHERE sz.benutzer_id = ? AND sz.status = 'veroeffentlicht' ORDER BY sz.datum`
    )
    .all(req.user!.sub) as { datum: string; bezeichnung: string; beginn: string; ende: string }[];

  const fmt = (d: string, t: string) => `${d.replace(/-/g, "")}T${t.replace(":", "")}00`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SchichtWeb//DE",
    ...rows.map((r) =>
      [
        "BEGIN:VEVENT",
        `UID:${r.datum}-${r.bezeichnung}-${req.user!.sub}@schichtweb`,
        `DTSTART:${fmt(r.datum, r.beginn)}`,
        `DTEND:${fmt(r.datum, r.ende)}`,
        `SUMMARY:${r.bezeichnung}`,
        "END:VEVENT",
      ].join("\r\n")
    ),
    "END:VCALENDAR",
  ];
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.send(lines.join("\r\n"));
});
