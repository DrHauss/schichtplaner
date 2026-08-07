import { Router } from "express";
import { db } from "../lib/db";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { email, passwort } = req.body ?? {};
  if (!email || !passwort) return res.status(400).json({ error: "email und passwort erforderlich" });
  const user = db.prepare("SELECT * FROM benutzer WHERE email = ?").get(email) as any;
  if (!user || !verifyPassword(passwort, user.passwort_hash)) {
    return res.status(401).json({ error: "Login fehlgeschlagen" });
  }
  if (!user.aktiv) {
    return res.status(401).json({ error: "Konto ist deaktiviert" });
  }
  const token = signToken({ sub: user.id, email: user.email, istAdmin: !!user.ist_admin });
  const mitgliedschaften = db
    .prepare(
      `SELECT m.id, m.rolle, p.id as planungseinheit_id, p.name as planungseinheit_name
       FROM mitgliedschaft m JOIN planungseinheit p ON p.id = m.planungseinheit_id
       WHERE m.benutzer_id = ?`
    )
    .all(user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, istAdmin: !!user.ist_admin },
    mitgliedschaften,
  });
});

authRouter.post("/register", (req, res) => {
  const { email, passwort, name, personalnr } = req.body ?? {};
  if (!email || !passwort || !name) return res.status(400).json({ error: "email, passwort, name erforderlich" });
  const exists = db.prepare("SELECT 1 FROM benutzer WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "E-Mail bereits registriert" });
  const info = db
    .prepare("INSERT INTO benutzer (email, passwort_hash, name, personalnr) VALUES (?,?,?,?)")
    .run(email, hashPassword(passwort), name, personalnr ?? null);
  const token = signToken({ sub: Number(info.lastInsertRowid), email, istAdmin: false });
  res.status(201).json({ token, user: { id: info.lastInsertRowid, email, name, istAdmin: false } });
});
