// Termingenerator fuer die Jahresabfrage (Konzept Kap. 3.1): erzeugt aus einer Serienregel
// die Liste der Termine eines Jahres, statt sie einzeln anlegen zu muessen.
import { ladeFeiertage } from "./feiertage";

export type RegelTyp = "woechentlich" | "monatlich" | "feiertage" | "einzeln";

export interface Regel {
  typ: RegelTyp;
  von?: string;
  bis?: string;
  wochentage?: number[]; // 0=Montag .. 6=Sonntag
  woche?: number; // 1..4 = n-ter Wochentag im Monat, -1 = letzter
  daten?: string[];
}

export interface Ausnahme {
  von: string;
  bis?: string;
}

export type Gruppierung = "pro_termin" | "pro_woche";

export interface GruppierterBlock {
  bezeichnung: string;
  termine: string[];
}

function jsWochentagZuMoSo(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function istAusnahme(datum: string, ausnahmen: Ausnahme[]): boolean {
  return ausnahmen.some((a) => datum >= a.von && datum <= (a.bis ?? a.von));
}

function nterWochentagImMonat(jahr: number, monat0: number, wochentag: number, woche: number): string | null {
  const letzterTag = new Date(Date.UTC(jahr, monat0 + 1, 0)).getUTCDate();
  if (woche > 0) {
    let treffer = 0;
    for (let tag = 1; tag <= letzterTag; tag++) {
      const d = new Date(Date.UTC(jahr, monat0, tag));
      if (jsWochentagZuMoSo(d.getUTCDay()) === wochentag) {
        treffer++;
        if (treffer === woche) return d.toISOString().slice(0, 10);
      }
    }
    return null;
  }
  for (let tag = letzterTag; tag >= 1; tag--) {
    const d = new Date(Date.UTC(jahr, monat0, tag));
    if (jsWochentagZuMoSo(d.getUTCDay()) === wochentag) return d.toISOString().slice(0, 10);
  }
  return null;
}

export function berechneTermine(regel: Regel, ausnahmen: Ausnahme[] = []): string[] {
  let termine: string[] = [];

  if (regel.typ === "einzeln") {
    termine = [...(regel.daten ?? [])];
  } else if (regel.typ === "feiertage") {
    if (!regel.von || !regel.bis) throw new Error("von und bis erforderlich");
    const jahrVon = Number(regel.von.slice(0, 4));
    const jahrBis = Number(regel.bis.slice(0, 4));
    for (let j = jahrVon; j <= jahrBis; j++) {
      for (const f of ladeFeiertage(j)) {
        if (f.istFrei && f.datum >= regel.von && f.datum <= regel.bis) termine.push(f.datum);
      }
    }
  } else if (regel.typ === "woechentlich") {
    if (!regel.von || !regel.bis || !regel.wochentage?.length) {
      throw new Error("von, bis und wochentage erforderlich");
    }
    const ende = new Date(`${regel.bis}T00:00:00Z`);
    for (let d = new Date(`${regel.von}T00:00:00Z`); d <= ende; d.setUTCDate(d.getUTCDate() + 1)) {
      if (regel.wochentage.includes(jsWochentagZuMoSo(d.getUTCDay()))) {
        termine.push(d.toISOString().slice(0, 10));
      }
    }
  } else if (regel.typ === "monatlich") {
    if (!regel.von || !regel.bis || !regel.wochentage?.length || !regel.woche) {
      throw new Error("von, bis, wochentage und woche erforderlich");
    }
    const start = new Date(`${regel.von}T00:00:00Z`);
    const ende = regel.bis;
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor.toISOString().slice(0, 10) <= ende) {
      for (const wt of regel.wochentage) {
        const datum = nterWochentagImMonat(cursor.getUTCFullYear(), cursor.getUTCMonth(), wt, regel.woche);
        if (datum && datum >= regel.von && datum <= regel.bis) termine.push(datum);
      }
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  }

  termine = termine.filter((d) => !istAusnahme(d, ausnahmen));
  return Array.from(new Set(termine)).sort();
}

// Ordnet einem Termin die passende Schichtart zu: bei woechentlich/monatlich parallel zur
// Position des Wochentags in regel.wochentage, sonst die erste angegebene Schichtart.
export function schichtartFuerDatum(datum: string, regel: Regel, schichtartIds: number[]): number {
  if ((regel.typ === "woechentlich" || regel.typ === "monatlich") && regel.wochentage?.length) {
    const wochentag = jsWochentagZuMoSo(new Date(`${datum}T00:00:00Z`).getUTCDay());
    const index = regel.wochentage.indexOf(wochentag);
    if (index >= 0 && schichtartIds[index] != null) return schichtartIds[index];
  }
  return schichtartIds[0];
}

function isoWoche(datumStr: string): string {
  const d = new Date(`${datumStr}T00:00:00Z`);
  const tagNr = jsWochentagZuMoSo(d.getUTCDay());
  d.setUTCDate(d.getUTCDate() - tagNr + 3);
  const ersterDonnerstag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  ersterDonnerstag.setUTCDate(ersterDonnerstag.getUTCDate() - jsWochentagZuMoSo(ersterDonnerstag.getUTCDay()) + 3);
  const woche = 1 + Math.round((d.getTime() - ersterDonnerstag.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(woche).padStart(2, "0")}`;
}

// Anzeigeformat TT.MM.JJJJ fuer die vom Generator erzeugten Bezeichnungen (Raster-Spaltenkoepfe,
// Planer-Karten, CSV-Export) -- der zugrunde liegende ISO-Termin bleibt in "termine" unveraendert
// fuer Sortierung/API-Nutzung erhalten.
function formatDatumKurz(iso: string): string {
  const [jahr, monat, tag] = iso.split("-");
  return `${tag}.${monat}.${jahr}`;
}

export function gruppiere(termine: string[], gruppierung: Gruppierung, bezeichnungVorlage: string): GruppierterBlock[] {
  if (gruppierung === "pro_termin") {
    return termine.map((t) => ({ bezeichnung: `${bezeichnungVorlage} ${formatDatumKurz(t)}`, termine: [t] }));
  }
  const gruppen = new Map<string, string[]>();
  for (const t of termine) {
    const key = isoWoche(t);
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key)!.push(t);
  }
  return Array.from(gruppen.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, ts]) => {
      const sortiert = [...ts].sort();
      const spanne =
        sortiert.length > 1
          ? `${formatDatumKurz(sortiert[0])}–${formatDatumKurz(sortiert[sortiert.length - 1])}`
          : formatDatumKurz(sortiert[0]);
      return { bezeichnung: `${bezeichnungVorlage} ${spanne}`, termine: sortiert };
    });
}
