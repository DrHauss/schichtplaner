import crypto from "crypto";
import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { hashPassword } from "../lib/auth";

// Plattformweite Benutzerverwaltung -- ausschliesslich fuer Administratoren. Tagesgeschaeft der
// Schichtplanung (Schichten, Vergabe, Abwesenheiten) bleibt bewusst bei den Planern der jeweiligen
// Planungseinheit; der Admin verwaltet stattdessen Konten und deren Rollenzuordnung uebergreifend.
export const benutzerRouter = Router();
benutzerRouter.use(requireAuth);

function requireAdmin(req: AuthedRequest, res: any): boolean {
  if (!req.user!.istAdmin) {
    res.status(403).json({ error: "Nur Administrator" });
    return false;
  }
  return true;
}

benutzerRouter.get("/", (req: AuthedRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const benutzer = db
    .prepare("SELECT id, email, name, personalnr, wochenstunden, soll_stunden_taeglich, ist_admin FROM benutzer ORDER BY name")
    .all() as any[];
  const mitStatus = benutzer.map((b) => {
    const mitgliedschaften = db
      .prepare(
        `SELECT m.id, m.rolle, p.id as planungseinheit_id, p.name as planungseinheit_name
         FROM mitgliedschaft m JOIN planungseinheit p ON p.id = m.planungseinheit_id WHERE m.benutzer_id = ?`
      )
      .all(b.id);
    return { ...b, mitgliedschaften };
  });
  res.json(mitStatus);
});

benutzerRouter.post("/", (req: AuthedRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const { name, email, personalnr, sollStundenTaeglich } = req.body ?? {};
  if (!name || !email) return res.status(400).json({ error: "name und email erforderlich" });
  const exists = db.prepare("SELECT 1 FROM benutzer WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "E-Mail bereits registriert" });

  const temporaeresPasswort = crypto.randomBytes(6).toString("base64url");
  const info = db
    .prepare("INSERT INTO benutzer (email, passwort_hash, name, personalnr, soll_stunden_taeglich) VALUES (?,?,?,?,?)")
    .run(email, hashPassword(temporaeresPasswort), name, personalnr ?? null, sollStundenTaeglich ?? null);
  res.status(201).json({ id: info.lastInsertRowid, email, name, temporaeresPasswort });
});

benutzerRouter.put("/:id", (req: AuthedRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const { name, personalnr, wochenstunden, sollStundenTaeglich, istAdmin } = req.body ?? {};
  const bestehend = db.prepare("SELECT id FROM benutzer WHERE id = ?").get(req.params.id);
  if (!bestehend) return res.status(404).json({ error: "Benutzer nicht gefunden" });
  db.prepare(
    `UPDATE benutzer SET name = COALESCE(?, name), personalnr = ?, wochenstunden = COALESCE(?, wochenstunden),
     soll_stunden_taeglich = ?, ist_admin = ? WHERE id = ?`
  ).run(
    name ?? null,
    personalnr ?? null,
    wochenstunden ?? null,
    sollStundenTaeglich === "" || sollStundenTaeglich == null ? null : sollStundenTaeglich,
    istAdmin ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});
