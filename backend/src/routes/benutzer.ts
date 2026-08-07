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
    .prepare("SELECT id, email, name, personalnr, wochenstunden, soll_stunden_taeglich, ist_admin, aktiv FROM benutzer ORDER BY name")
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
  const body: Record<string, unknown> = req.body ?? {};
  const benutzerId = Number(req.params.id);
  const bestehend = db.prepare("SELECT id FROM benutzer WHERE id = ?").get(benutzerId);
  if (!bestehend) return res.status(404).json({ error: "Benutzer nicht gefunden" });

  if ("aktiv" in body && !body.aktiv && benutzerId === req.user!.sub) {
    return res.status(400).json({ error: "Das eigene Konto kann nicht deaktiviert werden" });
  }
  if ("istAdmin" in body && !body.istAdmin && benutzerId === req.user!.sub) {
    return res.status(400).json({ error: "Der eigene Administrator-Status kann nicht entfernt werden" });
  }

  // Echtes Partial-Update: nur tatsaechlich mitgesendete Felder aendern. Ein Aufruf, der z. B. nur
  // "aktiv" setzt (siehe Frontend-Toggle), darf weder Soll-Stunden/Personalnummer loeschen noch --
  // sicherheitsrelevant -- den Admin-Status unbeabsichtigt auf 0 zuruecksetzen, weil er im Body fehlt.
  const felder: Record<string, unknown> = {};
  if ("name" in body) felder.name = body.name;
  if ("personalnr" in body) felder.personalnr = body.personalnr || null;
  if ("wochenstunden" in body) felder.wochenstunden = body.wochenstunden;
  if ("sollStundenTaeglich" in body) {
    felder.soll_stunden_taeglich = body.sollStundenTaeglich === "" || body.sollStundenTaeglich == null ? null : body.sollStundenTaeglich;
  }
  if ("istAdmin" in body) felder.ist_admin = body.istAdmin ? 1 : 0;
  if ("aktiv" in body) felder.aktiv = body.aktiv ? 1 : 0;

  if (Object.keys(felder).length > 0) {
    const setClause = Object.keys(felder)
      .map((spalte) => `${spalte} = ?`)
      .join(", ");
    db.prepare(`UPDATE benutzer SET ${setClause} WHERE id = ?`).run(...Object.values(felder), benutzerId);
  }
  res.json({ ok: true });
});

benutzerRouter.put("/:id/passwort", (req: AuthedRequest, res) => {
  if (!requireAdmin(req, res)) return;
  const { passwort } = req.body ?? {};
  if (!passwort || String(passwort).length < 8) {
    return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen haben" });
  }
  const bestehend = db.prepare("SELECT id FROM benutzer WHERE id = ?").get(req.params.id);
  if (!bestehend) return res.status(404).json({ error: "Benutzer nicht gefunden" });
  db.prepare("UPDATE benutzer SET passwort_hash = ? WHERE id = ?").run(hashPassword(String(passwort)), req.params.id);
  res.json({ ok: true });
});
