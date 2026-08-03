import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

interface ZuweisungKommentar {
  id: number;
  autorName: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstelltAm: string;
}

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
  ganztags?: boolean;
  // Der Server liefert 'nur_planer'-Kommentare nur an Planer der jeweiligen Einheit bzw. Admins.
  kommentare?: ZuweisungKommentar[];
}

interface FreischichtKommentar {
  id: number;
  benutzerId: number;
  datum: string;
  autorName: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstelltAm: string;
}

interface PlanungseinheitUebersicht {
  id: number;
  name: string;
  standort: string | null;
  mitarbeiter: { id: number; name: string }[];
  zuweisungen: Zuweisung[];
  freischichtKommentare?: FreischichtKommentar[];
}

interface FeiertagEintrag {
  datum: string;
  bezeichnung: string;
  istFrei: boolean;
}

const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function heuteJahrMonat() {
  const d = new Date();
  return { jahr: d.getFullYear(), monat: d.getMonth() + 1 };
}

function tageDesMonats(jahr: number, monat: number): string[] {
  const letzterTag = new Date(jahr, monat, 0).getDate();
  return Array.from({ length: letzterTag }, (_, i) => {
    const tag = i + 1;
    return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
  });
}

function wochentagKurz(datumIso: string): string {
  const d = new Date(`${datumIso}T00:00:00`);
  return WOCHENTAGE_KURZ[(d.getDay() + 6) % 7];
}

function istWochenende(datumIso: string): boolean {
  const d = new Date(`${datumIso}T00:00:00`);
  const tag = d.getDay();
  return tag === 0 || tag === 6;
}

// Teamuebergreifende, rein lesende Uebersicht der veroeffentlichten Schichten aller
// Planungseinheiten -- fuer alle angemeldeten Nutzer sichtbar, nicht nur fuer Planer oder
// Mitglieder der jeweiligen Einheit. Entwuerfe bleiben bewusst nur in der Plantafel der
// jeweiligen Planer sichtbar. Monatsweise Ansicht, da ein Wochenraster fuer den
// Gesamtueberblick ueber ein Team zu kleinteilig ist.
export default function TeamUebersichtPage() {
  const [{ jahr, monat }, setMonat] = useState(heuteJahrMonat());
  const [einheiten, setEinheiten] = useState<PlanungseinheitUebersicht[]>([]);
  const [feiertage, setFeiertage] = useState<FeiertagEintrag[]>([]);
  const [loading, setLoading] = useState(true);

  const tage = useMemo(() => tageDesMonats(jahr, monat), [jahr, monat]);
  const feiertagNachDatum = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of feiertage) if (f.istFrei) map.set(f.datum, f.bezeichnung);
    return map;
  }, [feiertage]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ planungseinheiten: PlanungseinheitUebersicht[] }>(`/uebersicht?von=${tage[0]}&bis=${tage[tage.length - 1]}`),
      api<FeiertagEintrag[]>(`/feiertage?jahr=${jahr}`),
    ])
      .then(([uebersicht, f]) => {
        setEinheiten(uebersicht.planungseinheiten);
        setFeiertage(f);
      })
      .finally(() => setLoading(false));
  }, [tage, jahr]);

  function monatWechseln(delta: number) {
    setMonat(({ jahr, monat }) => {
      const d = new Date(jahr, monat - 1 + delta, 1);
      return { jahr: d.getFullYear(), monat: d.getMonth() + 1 };
    });
  }

  function tagKlasse(t: string): string {
    const klassen: string[] = [];
    if (istWochenende(t)) klassen.push("wochenende");
    if (feiertagNachDatum.has(t)) klassen.push("feiertag");
    return klassen.join(" ");
  }

  const monatLabel = new Date(jahr, monat - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <div className="page">
      <h1>Team-Übersicht</h1>
      <p className="hint">Veröffentlichte Schichten aller Teams -- eigene Entwürfe eines Teams sind hier bewusst nicht sichtbar.</p>
      <div className="toolbar">
        <button onClick={() => monatWechseln(-1)}>← Vormonat</button>
        <span style={{ minWidth: "10rem", textAlign: "center" }}>{monatLabel}</span>
        <button onClick={() => monatWechseln(1)}>Nächster Monat →</button>
      </div>

      {loading && <div className="center-info">Lade…</div>}

      {!loading &&
        einheiten.map((pe) => {
          return (
            <section key={pe.id}>
              <h2>
                {pe.name}
                {pe.standort && <span className="hint"> · {pe.standort}</span>}
              </h2>
              {pe.mitarbeiter.length === 0 ? (
                <p className="empty">Keine Mitarbeiter in diesem Team.</p>
              ) : (
                <div className="uebersicht-monat-scroll">
                  <table className="table uebersicht-monat">
                    <thead>
                      <tr>
                        <th>Mitarbeiter</th>
                        {tage.map((t) => (
                          <th key={t} className={tagKlasse(t)} title={feiertagNachDatum.get(t)}>
                            <div className="tag-nr">{Number(t.slice(8, 10))}</div>
                            <div className="tag-wt">{wochentagKurz(t)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pe.mitarbeiter.map((m) => (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          {tage.map((t) => {
                            const treffer = pe.zuweisungen.filter((z) => z.benutzerId === m.id && z.datum === t);
                            return (
                              <td key={t} className={tagKlasse(t)}>
                                {treffer.length > 0 ? (
                                  treffer.map((z) => {
                                    const kommentare = z.kommentare ?? [];
                                    const titel =
                                      `${z.bezeichnung} (${z.ganztags ? "ganztägig" : `${z.beginn}–${z.ende}`})` +
                                      (kommentare.length > 0
                                        ? "\n\n" +
                                          kommentare
                                            .map(
                                              (k) =>
                                                `${k.sichtbarkeit === "nur_planer" ? "[nur Planer] " : ""}${k.autorName}: ${k.text}`
                                            )
                                            .join("\n")
                                        : "");
                                    return (
                                      <span key={z.id} className="badge" style={{ background: z.farbe }} title={titel}>
                                        {z.kuerzel}
                                        {kommentare.length > 0 && <span className="kommentar-marker" />}
                                      </span>
                                    );
                                  })
                                ) : (
                                  (() => {
                                    const freiKommentare = (pe.freischichtKommentare ?? []).filter(
                                      (k) => k.benutzerId === m.id && k.datum === t
                                    );
                                    const titel =
                                      "Freischicht" +
                                      (freiKommentare.length > 0
                                        ? "\n\n" +
                                          freiKommentare
                                            .map((k) => `${k.sichtbarkeit === "nur_planer" ? "[nur Planer] " : ""}${k.autorName}: ${k.text}`)
                                            .join("\n")
                                        : "");
                                    return (
                                      <span className="freischicht-hinweis" title={titel}>
                                        frei
                                        {freiKommentare.length > 0 && <span className="kommentar-marker" />}
                                      </span>
                                    );
                                  })()
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
