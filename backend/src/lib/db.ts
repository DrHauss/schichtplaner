import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "schichtweb.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS planungseinheit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  standort TEXT
);

CREATE TABLE IF NOT EXISTS qualifikation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bezeichnung TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS benutzer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  passwort_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  personalnr TEXT,
  wochenstunden REAL DEFAULT 0,
  eintritt TEXT,
  austritt TEXT,
  ist_admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS benutzer_qualifikation (
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  qualifikation_id INTEGER NOT NULL REFERENCES qualifikation(id) ON DELETE CASCADE,
  PRIMARY KEY (benutzer_id, qualifikation_id)
);

-- Rollen pro Planungseinheit: planer | mitarbeiter | betrachter
CREATE TABLE IF NOT EXISTS mitgliedschaft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  rolle TEXT NOT NULL CHECK (rolle IN ('planer','mitarbeiter','betrachter')),
  UNIQUE(benutzer_id, planungseinheit_id, rolle)
);

CREATE TABLE IF NOT EXISTS schichtart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  kuerzel TEXT NOT NULL,
  bezeichnung TEXT NOT NULL,
  farbe TEXT DEFAULT '#3b82f6',
  beginn TEXT NOT NULL,
  ende TEXT NOT NULL,
  pause_min INTEGER DEFAULT 0,
  stundenwert REAL,
  zuschlagsart TEXT
);

CREATE TABLE IF NOT EXISTS besetzungsbedarf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schichtart_id INTEGER NOT NULL REFERENCES schichtart(id) ON DELETE CASCADE,
  wochentag INTEGER NOT NULL, -- 0=Mo .. 6=So
  soll_anzahl INTEGER NOT NULL DEFAULT 1,
  qualifikation_id INTEGER REFERENCES qualifikation(id)
);

CREATE TABLE IF NOT EXISTS abwesenheit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL,
  von TEXT NOT NULL,
  bis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'beantragt' CHECK (status IN ('beantragt','genehmigt','abgelehnt'))
);

CREATE TABLE IF NOT EXISTS schicht_zuweisung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  schichtart_id INTEGER NOT NULL REFERENCES schichtart(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht')),
  quelle TEXT NOT NULL DEFAULT 'manuell' CHECK (quelle IN ('manuell','boerse','tausch')),
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(benutzer_id, datum, schichtart_id)
);

CREATE TABLE IF NOT EXISTS ausschreibung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  bewerbungsfrist TEXT NOT NULL,
  vergabeverfahren TEXT NOT NULL DEFAULT 'manuell' CHECK (vergabeverfahren IN ('manuell','fairness')),
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht','geschlossen')),
  min_bloecke INTEGER,
  max_bloecke INTEGER,
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schichtblock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  bezeichnung TEXT NOT NULL,
  personen_bedarf INTEGER NOT NULL DEFAULT 1,
  qualifikation_id INTEGER REFERENCES qualifikation(id)
);

CREATE TABLE IF NOT EXISTS blockschicht (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schichtblock_id INTEGER NOT NULL REFERENCES schichtblock(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  schichtart_id INTEGER NOT NULL REFERENCES schichtart(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bewerbung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schichtblock_id INTEGER NOT NULL REFERENCES schichtblock(id) ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  prioritaet INTEGER DEFAULT 1,
  kommentar TEXT,
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','zugesagt','abgelehnt','zurueckgezogen')),
  zeitstempel TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(schichtblock_id, benutzer_id)
);

CREATE TABLE IF NOT EXISTS vergabe_protokoll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schichtblock_id INTEGER NOT NULL REFERENCES schichtblock(id) ON DELETE CASCADE,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  entschieden_von INTEGER NOT NULL REFERENCES benutzer(id),
  entschieden_am TEXT DEFAULT CURRENT_TIMESTAMP,
  begruendung TEXT
);

CREATE TABLE IF NOT EXISTS benachrichtigung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empfaenger_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  typ TEXT NOT NULL,
  payload TEXT,
  gelesen_am TEXT,
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Serienregeln fuer den Termingenerator der Jahresabfrage (Konzept Kap. 3.1)
CREATE TABLE IF NOT EXISTS terminserie (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  bezeichnung      TEXT NOT NULL,
  regel            TEXT NOT NULL,
  schichtart_ids   TEXT NOT NULL,
  personen_bedarf  INTEGER NOT NULL DEFAULT 1,
  qualifikation_id INTEGER REFERENCES qualifikation(id),
  ausnahmen        TEXT,
  erstellt_am      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Teilnehmerkreis einer Jahresabfrage: entkoppelt "wer ist eingeladen" von Login/Mitgliedschaft (Konzept Kap. 3.3)
CREATE TABLE IF NOT EXISTS abfrage_teilnehmer (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  benutzer_id      INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  email            TEXT,
  token            TEXT UNIQUE,
  wunsch_anzahl    INTEGER,
  eingeladen_am    TEXT,
  erinnert_am      TEXT,
  abgegeben_am     TEXT,
  UNIQUE(ausschreibung_id, name)
);
`);

// SQLite erlaubt bei ALTER TABLE ... ADD COLUMN weder UNIQUE- noch PRIMARY-KEY-Constraints;
// neue Spalten werden daher nachtraeglich und idempotent ergaenzt (Konzept Kap. 5).
function ensureColumn(table: string, column: string, definition: string) {
  const spalten = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!spalten.some((s) => s.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("ausschreibung", "typ", "TEXT NOT NULL DEFAULT 'runde'");
ensureColumn("ausschreibung", "zeitraum_von", "TEXT");
ensureColumn("ausschreibung", "zeitraum_bis", "TEXT");
ensureColumn("ausschreibung", "antwort_modus", "TEXT NOT NULL DEFAULT 'ja_nein'");
ensureColumn("ausschreibung", "sichtbarkeit", "TEXT NOT NULL DEFAULT 'alle'");
ensureColumn("ausschreibung", "zugang", "TEXT NOT NULL DEFAULT 'login'");
ensureColumn("ausschreibung", "erinnerung_14_versendet", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("ausschreibung", "erinnerung_48h_versendet", "INTEGER NOT NULL DEFAULT 0");

ensureColumn("bewerbung", "antwort", "TEXT NOT NULL DEFAULT 'ja'");
ensureColumn("bewerbung", "geaendert_am", "TEXT");

ensureColumn("schichtblock", "terminserie_id", "INTEGER REFERENCES terminserie(id) ON DELETE CASCADE");
ensureColumn("schichtblock", "datum_sort", "TEXT");

// Mindestanzahl Zusagen gilt je Terminserie (Block-Kategorie), nicht pauschal fuer die ganze
// Jahresabfrage -- z. B. "mind. 3 Wochenende Fruehschicht" und getrennt "mind. 2 Nachtschicht-4er".
ensureColumn("terminserie", "mindest_zusagen", "INTEGER");
