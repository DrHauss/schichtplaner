import { db } from "./db";

// Eigenstaendiges, testbares Regelwerk fuer ArbZG-Pruefungen (§5 Ruhezeit, Doppelbelegung, Qualifikation)
export interface Konflikt {
  typ: "doppelbelegung" | "ruhezeit" | "qualifikation";
  meldung: string;
}

const RUHEZEIT_STD = 11;

function toDate(datum: string, zeit: string) {
  return new Date(`${datum}T${zeit}:00`);
}

export function pruefeKonflikte(benutzerId: number, schichtartId: number, datum: string): Konflikt[] {
  const konflikte: Konflikt[] = [];

  const neueSchicht = db.prepare("SELECT * FROM schichtart WHERE id = ?").get(schichtartId) as any;
  if (!neueSchicht) return konflikte;

  // Doppelbelegung am selben Tag
  const doppelt = db
    .prepare("SELECT 1 FROM schicht_zuweisung WHERE benutzer_id = ? AND datum = ?")
    .get(benutzerId, datum);
  if (doppelt) {
    konflikte.push({ typ: "doppelbelegung", meldung: `Mitarbeiter ist am ${datum} bereits verplant` });
  }

  // Abwesenheitsschichten (Krankheit, Urlaub, ...) sind keine Arbeitszeit -- Ruhezeit ist hier
  // nicht sinnvoll pruefbar bzw. relevant.
  if (neueSchicht.kategorie === "abwesenheit") return konflikte;

  // Ruhezeit: benachbarte Tage (Vortag/Folgetag) pruefen, Abwesenheitsschichten dabei ignorieren
  const nachbarn = db
    .prepare(
      `SELECT sz.datum, sa.beginn, sa.ende FROM schicht_zuweisung sz
       JOIN schichtart sa ON sa.id = sz.schichtart_id
       WHERE sz.benutzer_id = ? AND sz.datum IN (date(?, '-1 day'), date(?, '+1 day')) AND sa.kategorie != 'abwesenheit'`
    )
    .all(benutzerId, datum, datum) as { datum: string; beginn: string; ende: string }[];

  const neuBeginn = toDate(datum, neueSchicht.beginn);
  const neuEnde = toDate(datum, neueSchicht.ende <= neueSchicht.beginn ? neueSchicht.ende : neueSchicht.ende);
  // Falls Schicht ueber Mitternacht geht, Ende +1 Tag
  const neuEndeKorrigiert = neueSchicht.ende <= neueSchicht.beginn ? new Date(neuEnde.getTime() + 24 * 3600 * 1000) : neuEnde;

  for (const n of nachbarn) {
    const nBeginn = toDate(n.datum, n.beginn);
    const nEndeRaw = toDate(n.datum, n.ende);
    const nEnde = n.ende <= n.beginn ? new Date(nEndeRaw.getTime() + 24 * 3600 * 1000) : nEndeRaw;

    let ruhezeitStd: number;
    if (nEnde <= neuBeginn) {
      ruhezeitStd = (neuBeginn.getTime() - nEnde.getTime()) / 3600000;
    } else {
      ruhezeitStd = (nBeginn.getTime() - neuEndeKorrigiert.getTime()) / 3600000;
    }
    if (ruhezeitStd < RUHEZEIT_STD) {
      konflikte.push({
        typ: "ruhezeit",
        meldung: `Ruhezeit unterschritten (§5 ArbZG, min. ${RUHEZEIT_STD}h) zwischen Schicht am ${n.datum} und ${datum}`,
      });
    }
  }

  return konflikte;
}
