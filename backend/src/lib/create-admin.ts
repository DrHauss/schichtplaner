import { db } from "./db";
import { hashPassword } from "./auth";

// Einmaliger Bootstrap fuer den allerersten Administrator-Account im Produktivbetrieb -- bewusst
// getrennt von seed.ts, das Demo-Team, Testmitarbeiter und ein hart codiertes, oeffentlich
// bekanntes Passwort anlegt (nur fuer lokale Entwicklung/Vorfuehrung gedacht).
//
// Aufruf (nach dem Build, da dist/ ausgefuehrt wird):
//   node dist/lib/create-admin.js admin@firma.de "Max Mustermann" "ein-starkes-passwort"
// Im Docker-Compose-Betrieb z. B.:
//   docker compose exec backend node dist/lib/create-admin.js admin@firma.de "Max Mustermann" "..."
const [, , email, name, passwort] = process.argv;

if (!email || !name || !passwort) {
  console.error("Verwendung: create-admin <email> <name> <passwort>");
  process.exit(1);
}

const bestehend = db.prepare("SELECT id FROM benutzer WHERE email = ?").get(email) as { id: number } | undefined;
if (bestehend) {
  // Bewusst kein automatisches Ueberschreiben eines bestehenden Kontos -- ein versehentlicher
  // zweiter Aufruf soll nicht stillschweigend das Passwort eines echten Kontos zuruecksetzen.
  console.error(`Ein Benutzer mit der E-Mail ${email} existiert bereits (id ${bestehend.id}) -- Passwort wurde NICHT geaendert.`);
  process.exit(1);
}

const info = db
  .prepare("INSERT INTO benutzer (email, passwort_hash, name, ist_admin) VALUES (?,?,?,1)")
  .run(email, hashPassword(passwort), name);

console.log(`Administrator angelegt: ${name} <${email}> (id ${info.lastInsertRowid}).`);
