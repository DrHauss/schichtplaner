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

-- Schichtarten sind global -- sie gelten fuer alle Planungseinheiten gleichermassen. Ein
-- Mitarbeiter in mehreren Teams ist damit an einem Tag ueberall "belegt", sobald ihm irgendeine
-- Planungseinheit eine Schicht zugewiesen hat (siehe routes/plantafel.ts, routes/uebersicht.ts).
CREATE TABLE IF NOT EXISTS schichtart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kuerzel TEXT NOT NULL,
  bezeichnung TEXT NOT NULL,
  farbe TEXT DEFAULT '#0073d0',
  beginn TEXT NOT NULL,
  ende TEXT NOT NULL,
  pause_min INTEGER DEFAULT 0,
  stundenwert REAL,
  zuschlagsart TEXT
);

-- Bereitschaften (On-Call-Dienste) sind bewusst KEINE Schichtart -- sie sind weder Dienst noch
-- Abwesenheit, koennen mehrfach pro Tag und zusaetzlich zu einer normalen Schicht bestehen, und
-- loesen keine Doppelbelegungs-/Ruhezeit-Pruefung aus (siehe lib/regelwerk.ts). Global wie
-- Schichtarten -- gelten fuer alle Planungseinheiten gleichermassen.
CREATE TABLE IF NOT EXISTS bereitschaftsart (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kuerzel TEXT NOT NULL,
  bezeichnung TEXT NOT NULL,
  farbe TEXT DEFAULT '#812cc4',
  archiviert INTEGER NOT NULL DEFAULT 0
);

-- Mehrere Bereitschaften am selben Tag = mehrere Zeilen mit unterschiedlicher bereitschaftsart_id
-- (gleiches Muster wie schicht_zuweisung fuer mehrere Schichtarten am selben Tag).
CREATE TABLE IF NOT EXISTS bereitschaft_zuweisung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  bereitschaftsart_id INTEGER NOT NULL REFERENCES bereitschaftsart(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht')),
  quelle TEXT NOT NULL DEFAULT 'manuell' CHECK (quelle IN ('manuell','boerse')),
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(benutzer_id, bereitschaftsart_id, datum)
);

-- Mindestbesetzung: Soll-Anzahl einer Schichtart, getrennt je Wochentag (Wochenenden werden oft
-- anders besetzt als Werktage). Eine Regel wertet die Ist-Anzahl ueber eine oder mehrere
-- Planungseinheiten hinweg gemeinsam aus (siehe besetzungsregel_planungseinheit), nicht je Team
-- getrennt -- ein Team kann sich so mit einem anderen die Mindestbesetzung teilen.
-- warnt_bei_ueberbesetzung ist optional: neben der Unterbesetzung (die immer auffaellt) kann eine
-- Regel zusaetzlich auch dann auffallen, wenn mehr als die Zielgroesse vergeben wurde.
CREATE TABLE IF NOT EXISTS besetzungsregel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schichtart_id INTEGER NOT NULL REFERENCES schichtart(id) ON DELETE CASCADE,
  warnt_bei_ueberbesetzung INTEGER NOT NULL DEFAULT 0,
  ziel_mo INTEGER NOT NULL DEFAULT 1,
  ziel_di INTEGER NOT NULL DEFAULT 1,
  ziel_mi INTEGER NOT NULL DEFAULT 1,
  ziel_do INTEGER NOT NULL DEFAULT 1,
  ziel_fr INTEGER NOT NULL DEFAULT 1,
  ziel_sa INTEGER NOT NULL DEFAULT 1,
  ziel_so INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS besetzungsregel_planungseinheit (
  besetzungsregel_id INTEGER NOT NULL REFERENCES besetzungsregel(id) ON DELETE CASCADE,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  PRIMARY KEY (besetzungsregel_id, planungseinheit_id)
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

-- Ausschreibungen/Jahresabfragen sind nicht mehr zwingend an ein Team gebunden (siehe
-- ausschreibung_team unten) -- daher hier keine planungseinheit_id mehr.
CREATE TABLE IF NOT EXISTS ausschreibung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titel TEXT NOT NULL,
  bewerbungsfrist TEXT NOT NULL,
  vergabeverfahren TEXT NOT NULL DEFAULT 'manuell' CHECK (vergabeverfahren IN ('manuell','fairness')),
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht','geschlossen')),
  min_bloecke INTEGER,
  max_bloecke INTEGER,
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Team-Zuordnung einer Ausschreibung/Jahresabfrage: 0 Zeilen = gilt global (alle Teams/alle
-- Mitarbeiter), 1 Zeile = wie bisher genau ein Team, mehrere Zeilen = teamuebergreifend auf
-- mehrere gezielt ausgewaehlte Teams beschraenkt.
CREATE TABLE IF NOT EXISTS ausschreibung_team (
  ausschreibung_id   INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  UNIQUE(ausschreibung_id, planungseinheit_id)
);

CREATE TABLE IF NOT EXISTS schichtblock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  bezeichnung TEXT NOT NULL,
  personen_bedarf INTEGER NOT NULL DEFAULT 1,
  qualifikation_id INTEGER REFERENCES qualifikation(id)
);

-- Ein Eintrag ist entweder eine Schicht ODER eine Bereitschaft (siehe bereitschaftsart unten) --
-- nie beides, daher genau eine der beiden Spalten gesetzt.
CREATE TABLE IF NOT EXISTS blockschicht (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schichtblock_id INTEGER NOT NULL REFERENCES schichtblock(id) ON DELETE CASCADE,
  datum TEXT NOT NULL,
  schichtart_id INTEGER REFERENCES schichtart(id) ON DELETE CASCADE,
  bereitschaftsart_id INTEGER REFERENCES bereitschaftsart(id) ON DELETE CASCADE,
  CHECK ((schichtart_id IS NULL) != (bereitschaftsart_id IS NULL))
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

-- Mindestanzahl Zusagen kann je Terminserie vom Standard (terminserie.mindest_zusagen)
-- abweichen -- z. B. weniger Nachtschichten fuer Teilzeitkraefte. Ohne Eintrag hier gilt
-- der Standard der Serie.
CREATE TABLE IF NOT EXISTS terminserie_mindestzusagen (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  terminserie_id  INTEGER NOT NULL REFERENCES terminserie(id) ON DELETE CASCADE,
  teilnehmer_id   INTEGER NOT NULL REFERENCES abfrage_teilnehmer(id) ON DELETE CASCADE,
  mindest_zusagen INTEGER NOT NULL,
  UNIQUE(terminserie_id, teilnehmer_id)
);

-- Gruppe aus mehreren Terminserien mit einer gemeinsamen Mindestanzahl -- z. B. "Wochenenddienste"
-- aus den Serien "Fruehschicht" und "Spaetschicht", mind. 3 Zusagen insgesamt (z. B. 2x Fruehschicht
-- + 1x Spaetschicht). Gilt zusaetzlich zu, nicht statt, den Mindestanzahlen der einzelnen Serien.
CREATE TABLE IF NOT EXISTS terminserie_gruppe (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  bezeichnung     TEXT NOT NULL,
  mindest_zusagen INTEGER,
  erstellt_am     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terminserie_gruppe_mitglied (
  gruppe_id      INTEGER NOT NULL REFERENCES terminserie_gruppe(id) ON DELETE CASCADE,
  terminserie_id INTEGER NOT NULL REFERENCES terminserie(id) ON DELETE CASCADE,
  UNIQUE(gruppe_id, terminserie_id)
);

-- Mindestanzahl einer Gruppe kann ebenso wie bei einer einzelnen Serie je Teilnehmer abweichen.
CREATE TABLE IF NOT EXISTS gruppe_mindestzusagen (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  gruppe_id       INTEGER NOT NULL REFERENCES terminserie_gruppe(id) ON DELETE CASCADE,
  teilnehmer_id   INTEGER NOT NULL REFERENCES abfrage_teilnehmer(id) ON DELETE CASCADE,
  mindest_zusagen INTEGER NOT NULL,
  UNIQUE(gruppe_id, teilnehmer_id)
);

-- Wiederverwendbare Schichtblock-Vorlage fuer die direkte Zuweisung in der Plantafel (Top-down),
-- unabhaengig von einer Ausschreibung/Jahresabfrage -- z. B. "Wochenende Fruehschicht" (Tag 0+1)
-- oder "Nachtschicht 3er Block" (Tag 0,1,2). Ein Eintrag je enthaltenem Tag-Versatz + Schichtart.
CREATE TABLE IF NOT EXISTS schichtblock_vorlage (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  bezeichnung      TEXT NOT NULL,
  erstellt_am      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schichtblock_vorlage_eintrag (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vorlage_id      INTEGER NOT NULL REFERENCES schichtblock_vorlage(id) ON DELETE CASCADE,
  tag_offset      INTEGER NOT NULL,
  schichtart_id   INTEGER NOT NULL REFERENCES schichtart(id) ON DELETE CASCADE
);

-- Kommentare an einzelnen Schicht-Zuweisungen: nur Planer (bzw. Admins) duerfen kommentieren,
-- mehrere Kommentare je Zuweisung. Sichtbarkeit 'oeffentlich' = sichtbar fuer alle, die die
-- Schicht sehen (Team-Uebersicht, Mein Plan); 'nur_planer' = nur Planer der Planungseinheit/Admins.
CREATE TABLE IF NOT EXISTS schicht_kommentar (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zuweisung_id  INTEGER NOT NULL REFERENCES schicht_zuweisung(id) ON DELETE CASCADE,
  autor_id      INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  sichtbarkeit  TEXT NOT NULL DEFAULT 'nur_planer' CHECK (sichtbarkeit IN ('oeffentlich','nur_planer')),
  erstellt_am   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Feiertage je Jahr: beim ersten Zugriff auf ein Jahr automatisch aus der gesetzlichen
-- NRW-Regel generiert (siehe lib/feiertage.ts), danach bearbeitbar (Datum/Bezeichnung/ist_frei)
-- und um Sonderregelungen erweiterbar (zusaetzliche, manuell angelegte Eintraege).
CREATE TABLE IF NOT EXISTS feiertag (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jahr        INTEGER NOT NULL,
  datum       TEXT NOT NULL,
  bezeichnung TEXT NOT NULL,
  ist_frei    INTEGER NOT NULL DEFAULT 1,
  quelle      TEXT NOT NULL DEFAULT 'generiert',
  UNIQUE(jahr, bezeichnung)
);

-- Kommentare an Freischichten (Tage ohne Zuweisung): eigene Tabelle statt Erweiterung von
-- schicht_kommentar, da dessen zuweisung_id NOT NULL ist und eine Freischicht per Definition
-- keine Zuweisung hat. Adresse ist daher (benutzer_id, datum, planungseinheit_id) statt einer
-- zuweisung_id. Gleiche Sichtbarkeits-/Berechtigungslogik wie bei schicht_kommentar.
CREATE TABLE IF NOT EXISTS freischicht_kommentar (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  planungseinheit_id INTEGER NOT NULL REFERENCES planungseinheit(id) ON DELETE CASCADE,
  benutzer_id        INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  datum              TEXT NOT NULL,
  autor_id           INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  text               TEXT NOT NULL,
  sichtbarkeit       TEXT NOT NULL DEFAULT 'nur_planer' CHECK (sichtbarkeit IN ('oeffentlich','nur_planer')),
  erstellt_am        TEXT DEFAULT CURRENT_TIMESTAMP
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

// Eine Terminserie ist entweder ganz Schicht- oder ganz Bereitschafts-basiert (kein Mischen
// innerhalb einer Serie) -- genau eines der beiden *_ids-Felder ist gefuellt (siehe jahresabfrage.ts).
ensureColumn("terminserie", "bereitschaftsart_ids", "TEXT");

// Unterscheidet normale Dienst-Schichtarten von Abwesenheitsschichten (Krankheit, Urlaub, ...).
// Abwesenheitsschichten werden wie normale Schichten der Plantafel zugewiesen, loesen aber keine
// ArbZG-Konfliktpruefung (Ruhezeit) aus -- siehe regelwerk.ts.
ensureColumn("schichtart", "kategorie", "TEXT NOT NULL DEFAULT 'dienst'");

// Ganztags ist unabhaengig von kategorie (meist gekoppelt an 'abwesenheit', aber nicht erzwungen --
// z.B. denkbar waere eine ganztaegige Dienst-Schichtart wie "Bereitschaft ganztags").
ensureColumn("schichtart", "ganztags", "INTEGER NOT NULL DEFAULT 0");

// Taegliche Sollarbeitszeit je Mitarbeiter -- Grundlage fuer die Berechnung der
// Jahresarbeitszeit ueber die Arbeitstage des Jahres (siehe lib/feiertage.ts).
ensureColumn("benutzer", "soll_stunden_taeglich", "REAL");

// Deaktivierte Konten koennen sich nicht mehr einloggen (weder neu noch mit einem noch gueltigen
// Token, siehe requireAuth in middleware/auth.ts) -- fuer ausgeschiedene Mitarbeiter, ohne den
// Account samt Historie (Zuweisungen, Vergaben, ...) loeschen zu muessen.
ensureColumn("benutzer", "aktiv", "INTEGER NOT NULL DEFAULT 1");

// Archivierte Schichtarten bleiben in bestehenden Zuweisungen/der Planung sichtbar (Historie),
// koennen aber nicht mehr neu zugewiesen werden (weder einzeln noch ueber eine Vorlage, die sie
// enthaelt) -- siehe Sperre in routes/plantafel.ts.
ensureColumn("schichtart", "archiviert", "INTEGER NOT NULL DEFAULT 0");

// Migration: Schichtarten waren frueher je Planungseinheit definiert, gelten aber jetzt global.
// SQLite kann eine NOT NULL-Spalte nicht per ALTER TABLE entfernen -- daher Tabellen-Neubau statt
// ensureColumn. Bestehende Zeilen (samt id) bleiben erhalten, damit alle Fremdschluessel
// (schicht_zuweisung, schichtblock_vorlage_eintrag, besetzungsbedarf) weiterhin gueltig sind;
// zuvor pro Team angelegte, gleichnamige Schichtarten werden dabei NICHT automatisch
// zusammengefuehrt -- das erfordert eine bewusste Entscheidung, welche Zeile "gewinnt".
(function migriereSchichtartGlobal() {
  const spalten = db.prepare("PRAGMA table_info(schichtart)").all() as { name: string }[];
  if (!spalten.some((s) => s.name === "planungseinheit_id")) return;
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE schichtart_neu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kuerzel TEXT NOT NULL,
      bezeichnung TEXT NOT NULL,
      farbe TEXT DEFAULT '#0073d0',
      beginn TEXT NOT NULL,
      ende TEXT NOT NULL,
      pause_min INTEGER DEFAULT 0,
      stundenwert REAL,
      zuschlagsart TEXT,
      kategorie TEXT NOT NULL DEFAULT 'dienst',
      ganztags INTEGER NOT NULL DEFAULT 0,
      archiviert INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO schichtart_neu (id, kuerzel, bezeichnung, farbe, beginn, ende, pause_min, stundenwert, zuschlagsart, kategorie, ganztags, archiviert)
      SELECT id, kuerzel, bezeichnung, farbe, beginn, ende, pause_min, stundenwert, zuschlagsart, kategorie, ganztags, archiviert FROM schichtart;
    DROP TABLE schichtart;
    ALTER TABLE schichtart_neu RENAME TO schichtart;
  `);
  db.pragma("foreign_keys = ON");
})();

// Migration: Ausschreibungen/Jahresabfragen waren frueher zwingend genau einer Planungseinheit
// zugeordnet, koennen aber jetzt teamuebergreifend oder komplett global laufen (siehe
// ausschreibung_team oben). SQLite kann eine NOT NULL-Spalte nicht per ALTER TABLE entfernen --
// daher Tabellen-Neubau wie beim Schichtart-Umbau. Bestehende Werte werden vorher 1:1 nach
// ausschreibung_team uebernommen, damit das heutige Verhalten (genau ein Team) erhalten bleibt.
(function migriereAusschreibungTeamUebergreifend() {
  const spalten = db.prepare("PRAGMA table_info(ausschreibung)").all() as { name: string }[];
  if (!spalten.some((s) => s.name === "planungseinheit_id")) return;
  db.exec(`
    INSERT INTO ausschreibung_team (ausschreibung_id, planungseinheit_id)
      SELECT id, planungseinheit_id FROM ausschreibung WHERE planungseinheit_id IS NOT NULL;
  `);
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE ausschreibung_neu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titel TEXT NOT NULL,
      bewerbungsfrist TEXT NOT NULL,
      vergabeverfahren TEXT NOT NULL DEFAULT 'manuell' CHECK (vergabeverfahren IN ('manuell','fairness')),
      status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','veroeffentlicht','geschlossen')),
      min_bloecke INTEGER,
      max_bloecke INTEGER,
      erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
      typ TEXT NOT NULL DEFAULT 'runde',
      zeitraum_von TEXT,
      zeitraum_bis TEXT,
      antwort_modus TEXT NOT NULL DEFAULT 'ja_nein',
      sichtbarkeit TEXT NOT NULL DEFAULT 'alle',
      zugang TEXT NOT NULL DEFAULT 'login',
      erinnerung_14_versendet INTEGER NOT NULL DEFAULT 0,
      erinnerung_48h_versendet INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO ausschreibung_neu (id, titel, bewerbungsfrist, vergabeverfahren, status, min_bloecke, max_bloecke, erstellt_am,
        typ, zeitraum_von, zeitraum_bis, antwort_modus, sichtbarkeit, zugang, erinnerung_14_versendet, erinnerung_48h_versendet)
      SELECT id, titel, bewerbungsfrist, vergabeverfahren, status, min_bloecke, max_bloecke, erstellt_am,
        typ, zeitraum_von, zeitraum_bis, antwort_modus, sichtbarkeit, zugang, erinnerung_14_versendet, erinnerung_48h_versendet
      FROM ausschreibung;
    DROP TABLE ausschreibung;
    ALTER TABLE ausschreibung_neu RENAME TO ausschreibung;
  `);
  db.pragma("foreign_keys = ON");
})();

// Migration: blockschicht.schichtart_id war NOT NULL, ein Eintrag kann jetzt aber auch eine
// Bereitschaft statt einer Schicht sein (siehe bereitschaftsart oben) -- schichtart_id muss dafuer
// nullbar werden. SQLite kann eine NOT NULL-Spalte nicht per ALTER TABLE aendern -- daher
// Tabellen-Neubau wie bei den vorigen Migrationen. Bestehende Zeilen (samt id) bleiben erhalten.
(function migriereBlockschichtBereitschaftsfaehig() {
  const spalten = db.prepare("PRAGMA table_info(blockschicht)").all() as { name: string; notnull: number }[];
  const schichtartSpalte = spalten.find((s) => s.name === "schichtart_id");
  if (!schichtartSpalte || schichtartSpalte.notnull === 0) return;
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE blockschicht_neu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schichtblock_id INTEGER NOT NULL REFERENCES schichtblock(id) ON DELETE CASCADE,
      datum TEXT NOT NULL,
      schichtart_id INTEGER REFERENCES schichtart(id) ON DELETE CASCADE,
      bereitschaftsart_id INTEGER REFERENCES bereitschaftsart(id) ON DELETE CASCADE,
      CHECK ((schichtart_id IS NULL) != (bereitschaftsart_id IS NULL))
    );
    INSERT INTO blockschicht_neu (id, schichtblock_id, datum, schichtart_id)
      SELECT id, schichtblock_id, datum, schichtart_id FROM blockschicht;
    DROP TABLE blockschicht;
    ALTER TABLE blockschicht_neu RENAME TO blockschicht;
  `);
  db.pragma("foreign_keys = ON");
})();
