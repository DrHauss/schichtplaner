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

function upsertPlanungseinheit(name: string, standort: string) {
  const existing = db.prepare("SELECT id FROM planungseinheit WHERE name = ?").get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare("INSERT INTO planungseinheit (name, standort) VALUES (?,?)").run(name, standort);
  return Number(info.lastInsertRowid);
}

const peId = upsertPlanungseinheit("Pflegeteam Station 1", "Hauptstandort");
// Zweites Team, um Mitarbeiter in mehreren Teams und teamuebergreifende Szenarien (globale
// Bereitschaften, teamlose Schichtboerse, Plantafel-Mehrfachansicht) mit einer realistischen
// Nutzerzahl demonstrieren zu koennen.
const peId2 = upsertPlanungseinheit("Pflegeteam Station 2", "Nebenstandort");

const insertMitgliedschaft = db.prepare(
  "INSERT OR IGNORE INTO mitgliedschaft (benutzer_id, planungseinheit_id, rolle) VALUES (?,?,?)"
);
insertMitgliedschaft.run(planerId, peId, "planer");
insertMitgliedschaft.run(planerId, peId2, "planer");

// 20 Testmitarbeiter insgesamt: 15 in Team 1, 5 ausschliesslich in Team 2 -- die "Beispiel"-,
// "Muster"-, "Test"-, "Fiktiv"- und "Demo"-Nachnamen kennzeichnen sie klar als Testdaten.
const vornamen = [
  "Anna",
  "Ben",
  "Clara",
  "David",
  "Emma",
  "Felix",
  "Greta",
  "Hannah",
  "Ivo",
  "Jana",
  "Kevin",
  "Laura",
  "Max",
  "Nina",
  "Oskar",
  "Paul",
  "Quentin",
  "Rosa",
  "Sina",
  "Tom",
];
const nachnamen = ["Beispiel", "Muster", "Test", "Fiktiv", "Demo"];

const mitarbeiterIds = vornamen.map((vorname, i) =>
  upsertUser(`${vorname.toLowerCase()}@schichtweb.de`, `${vorname} ${nachnamen[i % nachnamen.length]}`, "test1234")
);

// Taegliche Sollarbeitszeit: ueberwiegend Vollzeit, jede fuenfte Testperson Teilzeit zur
// Abwechslung -- Grundlage der Jahresarbeitszeit-Berechnung (Sollarbeitszeit x Arbeitstage
// des Jahres in NRW).
mitarbeiterIds.forEach((id, i) => {
  const sollStunden = i % 5 === 2 ? 6 : 8;
  db.prepare("UPDATE benutzer SET soll_stunden_taeglich = ? WHERE id = ? AND soll_stunden_taeglich IS NULL").run(sollStunden, id);
});

// Bis auf die letzten 5 (ausschliesslich Team 2) sind alle Testmitarbeiter Team 1 zugewiesen.
const TEAM2_EXKLUSIV_ANZAHL = 5;
mitarbeiterIds.forEach((id, i) => {
  if (i < mitarbeiterIds.length - TEAM2_EXKLUSIV_ANZAHL) {
    insertMitgliedschaft.run(id, peId, "mitarbeiter");
  } else {
    insertMitgliedschaft.run(id, peId2, "mitarbeiter");
  }
});
// Anna (erste Testmitarbeiterin) ist zusaetzlich Mitglied von Team 2, um zu zeigen, dass ihre
// Schicht (Schichtarten sind global) automatisch fuer beide ihrer Teams gilt.
insertMitgliedschaft.run(mitarbeiterIds[0], peId2, "mitarbeiter");

// Schichtarten sind global -- sie gelten fuer alle Planungseinheiten gleichermassen (siehe lib/db.ts).
function upsertSchichtart(
  kuerzel: string,
  bezeichnung: string,
  farbe: string,
  beginn: string,
  ende: string,
  kategorie: "dienst" | "abwesenheit" = "dienst",
  ganztags = false,
  pauseMin = 30,
  stundenwert: number | null = 7.5
) {
  const existing = db.prepare("SELECT id FROM schichtart WHERE kuerzel = ?").get(kuerzel) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(
      "INSERT INTO schichtart (kuerzel, bezeichnung, farbe, beginn, ende, pause_min, stundenwert, kategorie, ganztags) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(kuerzel, bezeichnung, farbe, beginn, ende, pauseMin, stundenwert, kategorie, ganztags ? 1 : 0);
  return Number(info.lastInsertRowid);
}

const fruehId = upsertSchichtart("F", "Fruehschicht", "#22c55e", "06:00", "14:00");
const spaetId = upsertSchichtart("S", "Spaetschicht", "#f59e0b", "14:00", "22:00");
const nachtId = upsertSchichtart("N", "Nachtschicht", "#6366f1", "22:00", "06:00");
// Ganztaegige Abwesenheiten: keine Zeitspanne/Pause, Zeitwert bleibt leer (im Admin-Formular
// frei nachtragbar -- ein pauschaler Wert je Schichtart passt nicht zu Teilzeit-Mitarbeitern).
const krankId = upsertSchichtart("K", "Krankheit", "#ef4444", "00:00", "00:00", "abwesenheit", true, 0, null);
const urlaubId = upsertSchichtart("U", "Urlaub", "#94a3b8", "00:00", "00:00", "abwesenheit", true, 0, null);

function upsertVorlage(bezeichnung: string, eintraege: { tagOffset: number; schichtartId: number }[]) {
  const existing = db
    .prepare("SELECT id FROM schichtblock_vorlage WHERE planungseinheit_id = ? AND bezeichnung = ?")
    .get(peId, bezeichnung) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare("INSERT INTO schichtblock_vorlage (planungseinheit_id, bezeichnung) VALUES (?,?)").run(peId, bezeichnung);
  const vorlageId = Number(info.lastInsertRowid);
  const insertEintrag = db.prepare("INSERT INTO schichtblock_vorlage_eintrag (vorlage_id, tag_offset, schichtart_id) VALUES (?,?,?)");
  for (const e of eintraege) insertEintrag.run(vorlageId, e.tagOffset, e.schichtartId);
  return vorlageId;
}

upsertVorlage("Wochenende Fruehschicht", [
  { tagOffset: 0, schichtartId: fruehId },
  { tagOffset: 1, schichtartId: fruehId },
]);
upsertVorlage("Nachtschicht 3er Block", [
  { tagOffset: 0, schichtartId: nachtId },
  { tagOffset: 1, schichtartId: nachtId },
  { tagOffset: 2, schichtartId: nachtId },
]);

console.log("Seed abgeschlossen.");
console.log("Login-Daten:");
console.log("  Admin:       admin@schichtweb.de / admin123");
console.log("  Planer:      planer@schichtweb.de / planer123");
console.log(`  Mitarbeiter (${mitarbeiterIds.length}, jeweils test1234): ${vornamen.map((v) => `${v.toLowerCase()}@schichtweb.de`).join(", ")}`);
console.log(
  `  Davon Team 1: ${vornamen.length - 5} (${vornamen.slice(0, -5).join(", ")}) · Team 2: 5 exklusiv (${vornamen
    .slice(-5)
    .join(", ")}) + ${vornamen[0]} (zusaetzlich)`
);
console.log({ peId, peId2, fruehId, spaetId, nachtId, krankId, urlaubId });
