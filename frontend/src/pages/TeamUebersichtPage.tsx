import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatDatum } from "../lib/datum";

interface Zuweisung {
  id: number;
  datum: string;
  benutzerId: number;
  mitarbeiterName: string;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
  beginn: string;
  ende: string;
}

interface PlanungseinheitUebersicht {
  id: number;
  name: string;
  standort: string | null;
  zuweisungen: Zuweisung[];
}

function montagDieserWoche() {
  const d = new Date();
  const tag = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - tag);
  return d;
}

function wochenTage(startMontag: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startMontag);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// Teamuebergreifende, rein lesende Uebersicht der veroeffentlichten Schichten aller
// Planungseinheiten -- fuer alle angemeldeten Nutzer sichtbar, nicht nur fuer Planer oder
// Mitglieder der jeweiligen Einheit. Entwuerfe bleiben bewusst nur in der Plantafel der
// jeweiligen Planer sichtbar.
export default function TeamUebersichtPage() {
  const [woche, setWoche] = useState(montagDieserWoche());
  const [einheiten, setEinheiten] = useState<PlanungseinheitUebersicht[]>([]);
  const [loading, setLoading] = useState(true);

  const tage = useMemo(() => wochenTage(woche), [woche]);

  useEffect(() => {
    setLoading(true);
    api<{ planungseinheiten: PlanungseinheitUebersicht[] }>(`/uebersicht?von=${tage[0]}&bis=${tage[6]}`)
      .then((d) => setEinheiten(d.planungseinheiten))
      .finally(() => setLoading(false));
  }, [tage[0], tage[6]]);

  return (
    <div className="page">
      <h1>Team-Übersicht</h1>
      <p className="hint">Veröffentlichte Schichten aller Teams -- eigene Entwürfe eines Teams sind hier bewusst nicht sichtbar.</p>
      <div className="toolbar">
        <button onClick={() => setWoche((w) => new Date(w.getTime() - 7 * 86400000))}>← Vorwoche</button>
        <span>
          {formatDatum(tage[0])} – {formatDatum(tage[6])}
        </span>
        <button onClick={() => setWoche((w) => new Date(w.getTime() + 7 * 86400000))}>Nächste Woche →</button>
      </div>

      {loading && <div className="center-info">Lade…</div>}

      {!loading &&
        einheiten.map((pe) => {
          const mitarbeiterNamen = Array.from(new Set(pe.zuweisungen.map((z) => z.mitarbeiterName))).sort();
          return (
            <section key={pe.id}>
              <h2>
                {pe.name}
                {pe.standort && <span className="hint"> · {pe.standort}</span>}
              </h2>
              {mitarbeiterNamen.length === 0 ? (
                <p className="empty">Keine veröffentlichten Schichten in dieser Woche.</p>
              ) : (
                <table className="table plantafel">
                  <thead>
                    <tr>
                      <th>Mitarbeiter</th>
                      {tage.map((t) => (
                        <th key={t}>{formatDatum(t).slice(0, 5)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mitarbeiterNamen.map((name) => (
                      <tr key={name}>
                        <td>{name}</td>
                        {tage.map((t) => {
                          const treffer = pe.zuweisungen.filter((z) => z.mitarbeiterName === name && z.datum === t);
                          return (
                            <td key={t}>
                              {treffer.map((z) => (
                                <span key={z.id} className="badge" style={{ background: z.farbe }} title={`${z.bezeichnung} (${z.beginn}–${z.ende})`}>
                                  {z.kuerzel}
                                </span>
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
    </div>
  );
}
