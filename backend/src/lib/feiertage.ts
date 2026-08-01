// Gesetzliche Feiertage NRW: feste Termine + bewegliche Termine auf Basis des Osterdatums
// (Gauss'sche Osterformel, gregorianischer Kalender).
import { db } from "./db";

export interface Feiertag {
  datum: string; // YYYY-MM-DD
  bezeichnung: string;
}

function toDatum(jahr: number, monat: number, tag: number): string {
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

export function ostersonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

function plusTage(datum: Date, tage: number): Date {
  const kopie = new Date(datum.getTime());
  kopie.setUTCDate(kopie.getUTCDate() + tage);
  return kopie;
}

function alsDatumString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function feiertageNRW(jahr: number): Feiertag[] {
  const ostern = ostersonntag(jahr);
  return [
    { datum: toDatum(jahr, 1, 1), bezeichnung: "Neujahr" },
    { datum: toDatum(jahr, 1, 6), bezeichnung: "Heilige Drei Könige" },
    { datum: alsDatumString(plusTage(ostern, -2)), bezeichnung: "Karfreitag" },
    { datum: alsDatumString(plusTage(ostern, 1)), bezeichnung: "Ostermontag" },
    { datum: toDatum(jahr, 5, 1), bezeichnung: "Tag der Arbeit" },
    { datum: alsDatumString(plusTage(ostern, 39)), bezeichnung: "Christi Himmelfahrt" },
    { datum: alsDatumString(plusTage(ostern, 50)), bezeichnung: "Pfingstmontag" },
    { datum: alsDatumString(plusTage(ostern, 60)), bezeichnung: "Fronleichnam" },
    { datum: toDatum(jahr, 10, 3), bezeichnung: "Tag der Deutschen Einheit" },
    { datum: toDatum(jahr, 10, 31), bezeichnung: "Reformationstag" },
    { datum: toDatum(jahr, 11, 1), bezeichnung: "Allerheiligen" },
    { datum: toDatum(jahr, 12, 25), bezeichnung: "1. Weihnachtstag" },
    { datum: toDatum(jahr, 12, 26), bezeichnung: "2. Weihnachtstag" },
  ].sort((a, b) => a.datum.localeCompare(b.datum));
}

export interface Arbeitstage {
  jahr: number;
  wochentageGesamt: number; // Montag bis Freitag im Jahr, ohne Ruecksicht auf Feiertage
  feiertageAnWochentagen: number; // arbeitsfreie Feiertage (DB, ggf. bearbeitet/ergaenzt), die auf einen Wochentag fallen
  arbeitstage: number; // wochentageGesamt - feiertageAnWochentagen
}

function istWochenende(datum: Date): boolean {
  const tag = datum.getUTCDay();
  return tag === 0 || tag === 6;
}

export interface FeiertagEintrag extends Feiertag {
  id: number;
  jahr: number;
  istFrei: boolean;
  quelle: "generiert" | "manuell";
}

// Generiert beim ersten Zugriff auf ein Jahr die gesetzlichen NRW-Feiertage in der Datenbank.
// Existiert fuer das Jahr bereits mindestens ein Eintrag, wird nicht erneut generiert -- so
// bleiben spaetere Bearbeitungen (Umbenennung, Datum, Deaktivierung) und manuell ergaenzte
// Sonderregelungen dauerhaft erhalten, statt bei jedem Aufruf ueberschrieben zu werden.
function ensureFeiertageGeneriert(jahr: number) {
  const vorhanden = db.prepare("SELECT 1 FROM feiertag WHERE jahr = ? LIMIT 1").get(jahr);
  if (vorhanden) return;
  const insert = db.prepare(
    "INSERT INTO feiertag (jahr, datum, bezeichnung, ist_frei, quelle) VALUES (?,?,?,1,'generiert')"
  );
  for (const f of feiertageNRW(jahr)) insert.run(jahr, f.datum, f.bezeichnung);
}

// Laedt die Feiertage eines Jahres aus der Datenbank (inkl. Bearbeitungen und Sonderregelungen)
// und generiert bei Bedarf zuerst die gesetzlichen NRW-Feiertage als Ausgangsbasis.
export function ladeFeiertage(jahr: number): FeiertagEintrag[] {
  ensureFeiertageGeneriert(jahr);
  const rows = db.prepare("SELECT * FROM feiertag WHERE jahr = ? ORDER BY datum").all(jahr) as any[];
  return rows.map((r) => ({
    id: r.id,
    jahr: r.jahr,
    datum: r.datum,
    bezeichnung: r.bezeichnung,
    istFrei: !!r.ist_frei,
    quelle: r.quelle,
  }));
}

// Arbeitstage eines Jahres in NRW: Montag bis Freitag, abzueglich der als arbeitsfrei
// hinterlegten Feiertage (DB-gestuetzt, siehe ladeFeiertage), die auf einen Wochentag fallen
// (ein Feiertag am Wochenende reduziert die Arbeitstage nicht, da dieser Tag ohnehin kein
// Arbeitstag waere). Grundlage fuer die Jahresarbeitszeit-Berechnung.
export function berechneArbeitstage(jahr: number): Arbeitstage {
  let wochentageGesamt = 0;
  const ende = new Date(Date.UTC(jahr, 11, 31));
  for (let d = new Date(Date.UTC(jahr, 0, 1)); d <= ende; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!istWochenende(d)) wochentageGesamt++;
  }

  const feiertageAnWochentagen = ladeFeiertage(jahr).filter(
    (f) => f.istFrei && !istWochenende(new Date(`${f.datum}T00:00:00Z`))
  ).length;

  return { jahr, wochentageGesamt, feiertageAnWochentagen, arbeitstage: wochentageGesamt - feiertageAnWochentagen };
}
