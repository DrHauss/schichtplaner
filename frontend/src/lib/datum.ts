// Einheitliches Anzeigeformat TT.MM.JJJJ fuer alle vom Server gelieferten Datums-/Zeitwerte
// (ISO-Strings YYYY-MM-DD bzw. YYYY-MM-DDTHH:MM). Native <input type="date"> bleibt davon
// unberuehrt -- deren Anzeige steuert der Browser ueber die Systemsprache.
export function formatDatum(iso: string | null | undefined): string {
  if (!iso) return "";
  const datumsteil = iso.split("T")[0];
  const [jahr, monat, tag] = datumsteil.split("-");
  if (!jahr || !monat || !tag) return iso;
  return `${tag}.${monat}.${jahr}`;
}

// Trennzeichen zwischen Datum und Zeit ist je nach Quelle "T" (ISO) oder ein Leerzeichen
// (SQLite CURRENT_TIMESTAMP, z. B. "2026-08-03 09:02:49").
export function formatDatumZeit(iso: string | null | undefined): string {
  if (!iso) return "";
  const [datumsteil, zeitteil] = iso.split(/[T ]/);
  const datum = formatDatum(datumsteil);
  if (!zeitteil) return datum;
  return `${datum} ${zeitteil.slice(0, 5)} Uhr`;
}

// Wandelt eine TT.MM.JJJJ-Eingabe in das ISO-Format YYYY-MM-DD; unbekannte Formate (z. B.
// bereits ISO) werden unveraendert durchgereicht.
export function parseDatum(text: string): string {
  const bereinigt = text.trim();
  const treffer = bereinigt.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!treffer) return bereinigt;
  const [, tag, monat, jahr] = treffer;
  return `${jahr}-${monat.padStart(2, "0")}-${tag.padStart(2, "0")}`;
}
