import { db } from "./db";
import { hashPassword } from "./auth";

function upsertUser(email: string, name: string, passwort: string, istAdmin = false) {
  const existing = db.prepare("SELECT id FROM benutzer WHERE email = ?").get(email) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare("INSERT INTO benutzer (email, passwort_hash, name, ist_admin) VALUES (?,?,?,?)")
    .run(email, hashPassword(passwort), name, istAdmin ? 1 : 0);
  return Number(info.lastInsertRowid);
}

const adminId = upsertUser("admin@schichtweb.de", "System-Administrator", "admin123", true);
const planerId = upsertUser("planer@schichtweb.de", "Petra Planer", "planer123");
const mitarbeiter1 = upsertUser("anna@schichtweb.de", "Anna Beispiel", "test1234");
const mitarbeiter2 = upsertUser("ben@schichtweb.de", "Ben Muster", "test1234");
const mitarbeiter3 = upsertUser("clara@schichtweb.de", "Clara Test", "test1234");

let pe = db.prepare("SELECT id FROM planungseinheit WHERE name = ?").get("Pflegeteam Station 1") as
  | { id: number }
  | undefined;
let peId: number;
if (!pe) {
  const info = db
    .prepare("INSERT INTO planungseinheit (name, standort) VALUES (?,?)")
    .run("Pflegeteam Station 1", "Hauptstandort");
  peId = Number(info.lastInsertRowid);
} else {
  peId = pe.id;
}

const insertMitgliedschaft = db.prepare(
  "INSERT OR IGNORE INTO mitgliedschaft (benutzer_id, planungseinheit_id, rolle) VALUES (?,?,?)"
);
insertMitgliedschaft.run(planerId, peId, "planer");
insertMitgliedschaft.run(mitarbeiter1, peId, "mitarbeiter");
insertMitgliedschaft.run(mitarbeiter2, peId, "mitarbeiter");
insertMitgliedschaft.run(mitarbeiter3, peId, "mitarbeiter");

function upsertSchichtart(kuerzel: string, bezeichnung: string, farbe: string, beginn: string, ende: string) {
  const existing = db
    .prepare("SELECT id FROM schichtart WHERE planungseinheit_id = ? AND kuerzel = ?")
    .get(peId, kuerzel) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(
      "INSERT INTO schichtart (planungseinheit_id, kuerzel, bezeichnung, farbe, beginn, ende, pause_min, stundenwert) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(peId, kuerzel, bezeichnung, farbe, beginn, ende, 30, 7.5);
  return Number(info.lastInsertRowid);
}

const fruehId = upsertSchichtart("F", "Fruehschicht", "#22c55e", "06:00", "14:00");
const spaetId = upsertSchichtart("S", "Spaetschicht", "#f59e0b", "14:00", "22:00");
const nachtId = upsertSchichtart("N", "Nachtschicht", "#6366f1", "22:00", "06:00");

console.log("Seed abgeschlossen.");
console.log("Login-Daten:");
console.log("  Admin:      admin@schichtweb.de / admin123");
console.log("  Planer:     planer@schichtweb.de / planer123");
console.log("  Mitarbeiter: anna@schichtweb.de / ben@schichtweb.de / clara@schichtweb.de, jeweils test1234");
console.log({ peId, fruehId, spaetId, nachtId });
