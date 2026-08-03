import { formatDatum } from "../lib/datum";

export interface RasterSpalte {
  schichtblockId: number;
  bezeichnung: string;
  bedarf: number;
  datumSort: string | null;
  schichten: { datum: string; kuerzel: string; beginn: string | null; ende: string | null }[];
}

export interface RasterZelle {
  antwort: string;
  gesperrt: boolean;
  grund?: string;
}

export interface RasterVorgabe {
  quelle: "serie" | "gruppe";
  quelleId: number;
  bezeichnung: string;
  mindestZusagen: number;
  zusagenAnzahl: number;
  erfuellt: boolean;
}

export interface RasterZeile {
  teilnehmerId: number;
  benutzerId: number | null;
  name: string;
  wunschAnzahl: number | null;
  abgegebenAm: string | null;
  vorgaben: RasterVorgabe[];
  vollstaendig: boolean;
  versteckt: boolean;
  unbeantwortet: number[];
  zellen: Record<number, RasterZelle>;
}

export function unerfuellteVorgabenText(vorgaben: RasterVorgabe[]): string {
  return vorgaben
    .filter((v) => !v.erfuellt)
    .map((v) => `${v.bezeichnung}: ${v.zusagenAnzahl}/${v.mindestZusagen}`)
    .join(", ");
}

// Angebote (Schichtbloecke), fuer die noch ueberhaupt keine Antwort abgegeben wurde -- unabhaengig
// davon, ob dafuer eine Mindestanzahl-Vorgabe konfiguriert ist.
export function unbeantworteteAngeboteText(unbeantwortet: number[], spalten: RasterSpalte[]): string {
  const bezeichnungNachId = new Map(spalten.map((s) => [s.schichtblockId, s.bezeichnung]));
  return unbeantwortet.map((id) => bezeichnungNachId.get(id) ?? `#${id}`).join(", ");
}

export type RasterSummen = Record<number, { ja: number; wenn_noetig: number; nein: number }>;

const ANTWORT_KUERZEL: Record<string, string> = { ja: "Ja", wenn_noetig: "Wenn nötig", nein: "Nein" };

function ampel(summe: { ja: number; wenn_noetig: number; nein: number } | undefined, bedarf: number): "ok" | "knapp" | "eng" {
  if (!summe) return "eng";
  if (summe.ja >= bedarf) return "ok";
  if (summe.ja + summe.wenn_noetig >= bedarf) return "knapp";
  return "eng";
}

// Rasteransicht Personen x Termine, wie von der bisherigen Framadate-/STUdS-Umfrage bekannt:
// Summenzeile je Termin plus Bedarfszeile mit Ampel (Konzept Kap. 3.2). Reine Uebersicht fuer
// den Planer -- die eigene Antwort wird ueber die Terminliste erfasst.
export default function RasterMatrix({
  spalten,
  zeilen,
  summen,
}: {
  spalten: RasterSpalte[];
  zeilen: RasterZeile[];
  summen: RasterSummen;
}) {
  return (
    <div className="raster-scroll">
      <table className="table raster-matrix">
        <thead>
          <tr>
            <th>Name</th>
            {spalten.map((s) => (
              <th key={s.schichtblockId} title={s.schichten.map((sch) => `${formatDatum(sch.datum)} ${sch.kuerzel}`).join(", ")}>
                {s.bezeichnung}
              </th>
            ))}
          </tr>
          <tr className="raster-bedarf-zeile">
            <th>Bedarf</th>
            {spalten.map((s) => (
              <th key={s.schichtblockId}>{s.bedarf}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.teilnehmerId}>
              <td>
                {z.name}
                {!z.vollstaendig && (
                  <span className="hint" title={unerfuellteVorgabenText(z.vorgaben)}>
                    {" "}
                    · unvollständig
                  </span>
                )}
              </td>
              {spalten.map((s) => {
                const zelle = z.zellen[s.schichtblockId];
                if (z.versteckt || !zelle) return <td key={s.schichtblockId} className="raster-versteckt">·</td>;
                if (zelle.gesperrt) {
                  return (
                    <td key={s.schichtblockId} className="raster-gesperrt" title={zelle.grund}>
                      {zelle.grund ?? "gesperrt"}
                    </td>
                  );
                }
                return (
                  <td key={s.schichtblockId} className={zelle.antwort ? `raster-antwort-${zelle.antwort}` : ""}>
                    {ANTWORT_KUERZEL[zelle.antwort] ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Ja</th>
            {spalten.map((s) => (
              <th key={s.schichtblockId}>{summen[s.schichtblockId]?.ja ?? 0}</th>
            ))}
          </tr>
          <tr>
            <th>Wenn nötig</th>
            {spalten.map((s) => (
              <th key={s.schichtblockId}>{summen[s.schichtblockId]?.wenn_noetig ?? 0}</th>
            ))}
          </tr>
          <tr>
            <th>Status</th>
            {spalten.map((s) => (
              <th key={s.schichtblockId} className={`ampel ampel-${ampel(summen[s.schichtblockId], s.bedarf)}`}>
                {ampel(summen[s.schichtblockId], s.bedarf)}
              </th>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
