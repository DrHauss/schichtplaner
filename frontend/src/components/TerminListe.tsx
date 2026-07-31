import { useState } from "react";
import { RasterSpalte, RasterZelle } from "./RasterMatrix";
import { formatDatum } from "../lib/datum";

const OPTIONEN: { wert: string; label: string }[] = [
  { wert: "ja", label: "Ja" },
  { wert: "wenn_noetig", label: "Wenn nötig" },
  { wert: "nein", label: "Nein" },
];

// Mobil-/Teilnehmeransicht: ein Termin pro Karte mit drei grossen Schaltflaechen statt einer
// breiten Matrix (Konzept Kap. 3.2). Wird sowohl auf der Token-Seite als auch von angemeldeten
// Mitarbeitern fuer die eigene Zeile verwendet.
export default function TerminListe({
  spalten,
  zellen,
  onAntwort,
}: {
  spalten: RasterSpalte[];
  zellen: Record<number, RasterZelle>;
  onAntwort: (schichtblockId: number, antwort: string) => Promise<string[] | void>;
}) {
  const [speichert, setSpeichert] = useState<number | null>(null);
  const [warnungen, setWarnungen] = useState<Record<number, string[]>>({});

  async function waehlen(schichtblockId: number, antwort: string) {
    setSpeichert(schichtblockId);
    try {
      const w = await onAntwort(schichtblockId, antwort);
      setWarnungen((prev) => ({ ...prev, [schichtblockId]: w ?? [] }));
    } finally {
      setSpeichert(null);
    }
  }

  return (
    <div className="termin-liste">
      {spalten.map((s) => {
        const zelle = zellen[s.schichtblockId];
        const meldungen = warnungen[s.schichtblockId];
        return (
          <div className="card termin-karte" key={s.schichtblockId}>
            <div className="termin-karte-kopf">
              <strong>{s.bezeichnung}</strong>
              <span className="hint">Bedarf {s.bedarf}</span>
            </div>
            <ul className="schicht-list">
              {s.schichten.map((sch, i) => (
                <li key={i}>
                  {formatDatum(sch.datum)} · {sch.kuerzel} ({sch.beginn}–{sch.ende})
                </li>
              ))}
            </ul>
            {zelle?.gesperrt ? (
              <p className="raster-gesperrt-hinweis">Gesperrt: {zelle.grund}</p>
            ) : (
              <div className="termin-antwort-buttons">
                {OPTIONEN.map((o) => (
                  <button
                    key={o.wert}
                    type="button"
                    disabled={speichert === s.schichtblockId}
                    className={zelle?.antwort === o.wert ? `antwort-btn antwort-${o.wert} aktiv` : `antwort-btn antwort-${o.wert}`}
                    onClick={() => waehlen(s.schichtblockId, o.wert)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {meldungen && meldungen.length > 0 && <p className="hint">Hinweis: {meldungen.join("; ")}</p>}
          </div>
        );
      })}
      {spalten.length === 0 && <p className="empty">Noch keine Termine angelegt.</p>}
    </div>
  );
}
