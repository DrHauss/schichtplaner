import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, Konflikt } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDatum, formatDatumZeit } from "../lib/datum";

interface Mitarbeiter {
  id: number;
  name: string;
}
interface Schichtart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
  kategorie: "dienst" | "abwesenheit";
  archiviert: boolean | number;
}
interface Zuweisung {
  id: number;
  benutzer_id: number;
  schichtart_id: number;
  datum: string;
  status: string;
}
interface VorlageEintrag {
  tag_offset: number;
  schichtart_id: number;
  kuerzel: string;
}
interface Vorlage {
  id: number;
  bezeichnung: string;
  eintraege: VorlageEintrag[];
  enthaeltArchivierte: boolean | number;
}
interface Kommentar {
  id: number;
  zuweisung_id: number;
  autor_name: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstellt_am: string;
}
interface FreischichtKommentar {
  id: number;
  benutzer_id: number;
  datum: string;
  autor_name: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstellt_am: string;
}
interface Planungseinheit {
  id: number;
  name: string;
}

// Werkzeug der Palette: einmal auswaehlen, dann Zellen anklicken (Stempel-Prinzip).
type Werkzeug =
  | { art: "schichtart"; schichtart: Schichtart }
  | { art: "vorlage"; vorlage: Vorlage }
  | { art: "radierer" };

const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Schichtarten werden grundsaetzlich alphabetisch sortiert und in Dienst/Abwesenheit gruppiert
// dargestellt -- localeCompare("de") statt SQLite-Sortierung wegen deutscher Umlaute.
function nachDienstUndAbwesenheitGruppiert<
  T extends { kategorie: string; bezeichnung: string; archiviert?: boolean | number }
>(liste: T[]) {
  // Archivierte Schichtarten wandern innerhalb ihrer Gruppe immer ans Ende, unabhaengig vom Alphabet.
  const sortiert = (arr: T[]) =>
    [...arr].sort((a, b) => {
      const archivDiff = Number(!!a.archiviert) - Number(!!b.archiviert);
      if (archivDiff !== 0) return archivDiff;
      return a.bezeichnung.localeCompare(b.bezeichnung, "de");
    });
  return {
    dienst: sortiert(liste.filter((s) => s.kategorie !== "abwesenheit")),
    abwesenheit: sortiert(liste.filter((s) => s.kategorie === "abwesenheit")),
  };
}

function wochenTage(startMontag: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startMontag);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function montagDieserWoche() {
  const d = new Date();
  const tag = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - tag);
  return d;
}

function istWochenende(datumIso: string): boolean {
  const tag = new Date(`${datumIso}T00:00:00`).getDay();
  return tag === 0 || tag === 6;
}

// Konfliktliste einer 409-Antwort lesbar aufbereiten; bei Schichtbloecken ist je Konflikt ein
// Datum dabei, bei Einzelzuweisungen nicht.
function konfliktText(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const konflikte = (err.details?.konflikte ?? []) as Konflikt[];
  if (konflikte.length === 0) return err.message;
  return konflikte.map((k) => (k.datum ? `${formatDatum(k.datum)}: ${k.meldung}` : k.meldung)).join("\n");
}

export default function PlantafelPage() {
  const { user, mitgliedschaften } = useAuth();
  const planerEinheiten = mitgliedschaften.filter((m) => m.rolle === "planer");
  const istAdmin = !!user?.istAdmin;

  // Administratoren duerfen laut Backend ueberall planen, haben aber oft keine Mitgliedschaft --
  // fuer sie werden alle Planungseinheiten geladen.
  const [adminEinheiten, setAdminEinheiten] = useState<Planungseinheit[]>([]);
  useEffect(() => {
    if (istAdmin) api<Planungseinheit[]>("/planungseinheiten").then(setAdminEinheiten);
  }, [istAdmin]);

  const einheiten = useMemo(
    () =>
      planerEinheiten.length > 0
        ? planerEinheiten.map((m) => ({ id: m.planungseinheit_id, name: m.planungseinheit_name }))
        : adminEinheiten,
    [mitgliedschaften, adminEinheiten]
  );

  const [peId, setPeId] = useState<number | null>(null);
  useEffect(() => {
    if (peId == null && einheiten.length > 0) setPeId(einheiten[0].id);
  }, [einheiten, peId]);

  const [woche, setWoche] = useState(montagDieserWoche());
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [zuweisungen, setZuweisungen] = useState<Zuweisung[]>([]);
  const [kommentare, setKommentare] = useState<Kommentar[]>([]);
  const [freischichtKommentare, setFreischichtKommentare] = useState<FreischichtKommentar[]>([]);
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([]);
  const [feiertage, setFeiertage] = useState<Set<string>>(new Set());
  const [werkzeug, setWerkzeug] = useState<Werkzeug | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [freischichtDetail, setFreischichtDetail] = useState<{ benutzerId: number; datum: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ziehen: nach Auswahl von Schichtart oder Radierer koennen mehrere Zellen in einem Zug
  // erfasst werden (Maus gedrueckt halten, ueber Zellen fahren, loslassen). Die erfassten Zellen
  // liegen in einer Ref (kein Re-Render pro Eintrag), ein Tick-Zaehler stoesst die Neuzeichnung
  // fuer die Ziehen-Markierung an.
  const dragZellenRef = useRef<Map<string, { benutzerId: number; datum: string }>>(new Map());
  const [dragAktiv, setDragAktiv] = useState(false);
  const [, setDragTick] = useState(0);

  const tage = useMemo(() => wochenTage(woche), [woche]);

  function load() {
    if (!peId) return;
    api<{
      mitarbeiter: Mitarbeiter[];
      zuweisungen: Zuweisung[];
      schichtarten: Schichtart[];
      kommentare: Kommentar[];
      freischichtKommentare: FreischichtKommentar[];
    }>(`/planungseinheiten/${peId}/plantafel?von=${tage[0]}&bis=${tage[6]}`).then((d) => {
      setMitarbeiter(d.mitarbeiter);
      setZuweisungen(d.zuweisungen);
      setSchichtarten(d.schichtarten);
      setKommentare(d.kommentare ?? []);
      setFreischichtKommentare(d.freischichtKommentare ?? []);
    });
    api<Vorlage[]>(`/planungseinheiten/${peId}/schichtblock-vorlagen`).then(setVorlagen);
  }

  useEffect(() => {
    load();
    setDetailId(null);
    setFreischichtDetail(null);
  }, [peId, woche]);

  useEffect(() => {
    const jahr = Number(tage[0].slice(0, 4));
    api<{ datum: string; istFrei: boolean }[]>(`/feiertage?jahr=${jahr}`).then((f) =>
      setFeiertage(new Set(f.filter((x) => x.istFrei).map((x) => x.datum)))
    );
  }, [tage[0].slice(0, 4)]);

  function zellenZuweisungen(benutzerId: number, datum: string) {
    return zuweisungen.filter((z) => z.benutzer_id === benutzerId && z.datum === datum);
  }

  function kommentareFuer(zuweisungId: number) {
    return kommentare.filter((k) => k.zuweisung_id === zuweisungId);
  }

  function freischichtKommentareFuer(benutzerId: number, datum: string) {
    return freischichtKommentare.filter((k) => k.benutzer_id === benutzerId && k.datum === datum);
  }

  // Ein POST, bei Konflikten (409) Rueckfrage mit den konkreten Meldungen und Wiederholung mit force.
  async function postMitKonfliktabfrage(pfad: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(pfad, { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      const text = konfliktText(err);
      if (text === null) {
        setError((err as Error).message);
        return;
      }
      if (!confirm(`Konflikte:\n${text}\n\nTrotzdem zuweisen?`)) return;
      await api(pfad, { method: "POST", body: JSON.stringify({ ...body, force: true }) });
    }
    load();
  }

  async function zelleKlick(benutzerId: number, datum: string) {
    if (!werkzeug || busy) return;
    setBusy(true);
    try {
      if (werkzeug.art === "schichtart") {
        await postMitKonfliktabfrage("/zuweisungen", {
          benutzerId,
          schichtartId: werkzeug.schichtart.id,
          datum,
          planungseinheitId: peId,
        });
      } else if (werkzeug.art === "vorlage") {
        await postMitKonfliktabfrage(`/schichtblock-vorlagen/${werkzeug.vorlage.id}/zuweisen`, {
          benutzerId,
          startDatum: datum,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  // Mehrere per Ziehen erfasste Zellen in einem Zug zuweisen. Konflikte einzelner Zellen werden
  // gesammelt und in einer einzigen Rueckfrage gebuendelt (statt einem Dialog je Zelle).
  async function batchZuweisen(zellen: { benutzerId: number; datum: string }[], schichtartId: number) {
    setBusy(true);
    setError(null);
    const konflikte: { benutzerId: number; datum: string; text: string }[] = [];
    for (const z of zellen) {
      try {
        await api("/zuweisungen", {
          method: "POST",
          body: JSON.stringify({ benutzerId: z.benutzerId, schichtartId, datum: z.datum, planungseinheitId: peId }),
        });
      } catch (err) {
        const text = konfliktText(err);
        if (text === null) {
          setError((err as Error).message);
          setBusy(false);
          load();
          return;
        }
        konflikte.push({ ...z, text });
      }
    }
    if (konflikte.length > 0) {
      const liste = konflikte
        .map((k) => `${mitarbeiter.find((m) => m.id === k.benutzerId)?.name ?? ""} ${formatDatum(k.datum)}: ${k.text}`)
        .join("\n");
      if (confirm(`Konflikte bei ${konflikte.length} Zelle(n):\n${liste}\n\nTrotzdem zuweisen?`)) {
        for (const k of konflikte) {
          await api("/zuweisungen", {
            method: "POST",
            body: JSON.stringify({ benutzerId: k.benutzerId, schichtartId, datum: k.datum, planungseinheitId: peId, force: true }),
          });
        }
      }
    }
    setBusy(false);
    load();
  }

  async function batchLoeschen(zellen: { benutzerId: number; datum: string }[]) {
    setBusy(true);
    const ids = zellen.flatMap((z) => zellenZuweisungen(z.benutzerId, z.datum).map((zw) => zw.id));
    for (const id of ids) {
      await api(`/zuweisungen/${id}`, { method: "DELETE" });
    }
    setBusy(false);
    load();
  }

  function zieheZelleHinzu(benutzerId: number, datum: string) {
    dragZellenRef.current.set(`${benutzerId}|${datum}`, { benutzerId, datum });
    setDragTick((t) => t + 1);
  }

  function zelleMouseDown(benutzerId: number, datum: string) {
    if (!werkzeug || busy) return;
    if (werkzeug.art === "vorlage") {
      // Eine Vorlage spannt bereits mehrere Tage auf -- kein Ziehen noetig, sofortige Zuweisung.
      zelleKlick(benutzerId, datum);
      return;
    }
    dragZellenRef.current = new Map();
    setDragAktiv(true);
    zieheZelleHinzu(benutzerId, datum);
  }

  function zelleMouseEnter(benutzerId: number, datum: string) {
    if (!dragAktiv) return;
    zieheZelleHinzu(benutzerId, datum);
  }

  useEffect(() => {
    if (!dragAktiv) return;
    function beenden() {
      setDragAktiv(false);
      const zellen = Array.from(dragZellenRef.current.values());
      dragZellenRef.current = new Map();
      setDragTick((t) => t + 1);
      if (zellen.length === 0 || !werkzeug) return;
      if (werkzeug.art === "schichtart") batchZuweisen(zellen, werkzeug.schichtart.id);
      else if (werkzeug.art === "radierer") batchLoeschen(zellen);
    }
    window.addEventListener("mouseup", beenden);
    return () => window.removeEventListener("mouseup", beenden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragAktiv]);

  async function badgeKlick(z: Zuweisung) {
    if (busy || werkzeug) return; // mit aktivem Werkzeug uebernimmt Ziehen/Klick auf die Zelle
    setDetailId(z.id);
  }

  function freiKlick(benutzerId: number, datum: string) {
    if (busy || werkzeug) return; // mit aktivem Werkzeug uebernimmt Ziehen/Klick auf die Zelle
    setFreischichtDetail({ benutzerId, datum });
  }

  async function zuweisungLoeschen(z: Zuweisung) {
    const anzahl = kommentareFuer(z.id).length;
    const frage = anzahl > 0 ? `Zuweisung inklusive ${anzahl} Kommentar(en) löschen?` : "Zuweisung löschen?";
    if (!confirm(frage)) return;
    await api(`/zuweisungen/${z.id}`, { method: "DELETE" });
    setDetailId(null);
    load();
  }

  async function veroeffentlichen() {
    if (!peId) return;
    const res = await api<{ anzahlMitarbeiter: number }>(`/planungseinheiten/${peId}/veroeffentlichen`, {
      method: "POST",
      body: JSON.stringify({ von: tage[0], bis: tage[6] }),
    });
    alert(`Plan veröffentlicht, ${res.anzahlMitarbeiter} Mitarbeiter benachrichtigt.`);
    load();
  }

  if (einheiten.length === 0) return <p className="empty">Keine Planer-Berechtigung.</p>;

  const detailZuweisung = detailId != null ? zuweisungen.find((z) => z.id === detailId) : undefined;

  return (
    <div className="page">
      <h1>Plantafel</h1>

      <div className="toolbar">
        {einheiten.length > 1 && (
          <select value={peId ?? ""} onChange={(e) => setPeId(Number(e.target.value))}>
            {einheiten.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setWoche((w) => new Date(w.getTime() - 7 * 86400000))}>← Vorwoche</button>
        <span>
          {formatDatum(tage[0])} – {formatDatum(tage[6])}
        </span>
        <button onClick={() => setWoche((w) => new Date(w.getTime() + 7 * 86400000))}>Nächste Woche →</button>
        <button onClick={veroeffentlichen}>Plan veröffentlichen</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card palette">
        <div className="palette-gruppe">
          <span className="palette-label">Einzelschichten</span>
          {(() => {
            const { dienst, abwesenheit } = nachDienstUndAbwesenheitGruppiert(schichtarten.filter((sa) => !sa.archiviert));
            const knopf = (sa: Schichtart) => (
              <button
                key={sa.id}
                type="button"
                className={`palette-item${werkzeug?.art === "schichtart" && werkzeug.schichtart.id === sa.id ? " aktiv" : ""}`}
                style={{ background: sa.farbe, color: "white" }}
                title={sa.bezeichnung}
                onClick={() => setWerkzeug({ art: "schichtart", schichtart: sa })}
              >
                {sa.kuerzel}
              </button>
            );
            return (
              <>
                {dienst.length > 0 && (
                  <>
                    <span className="palette-unterlabel">Dienste</span>
                    {dienst.map(knopf)}
                  </>
                )}
                {abwesenheit.length > 0 && (
                  <>
                    <span className="palette-unterlabel">Abwesenheiten</span>
                    {abwesenheit.map(knopf)}
                  </>
                )}
              </>
            );
          })()}
          {schichtarten.every((sa) => sa.archiviert) && <span className="empty">Keine aktiven Schichtarten.</span>}
        </div>

        <div className="palette-gruppe">
          <span className="palette-label">Schichtblöcke</span>
          {vorlagen
            .filter((v) => !v.enthaeltArchivierte)
            .map((v) => (
              <button
                key={v.id}
                type="button"
                className={`palette-item palette-vorlage${werkzeug?.art === "vorlage" && werkzeug.vorlage.id === v.id ? " aktiv" : ""}`}
                title={v.eintraege.map((e) => `Tag ${e.tag_offset + 1}: ${e.kuerzel}`).join(", ")}
                onClick={() => setWerkzeug({ art: "vorlage", vorlage: v })}
              >
                {v.bezeichnung}
              </button>
            ))}
          {vorlagen.length === 0 && <span className="empty">Keine Schichtblock-Vorlagen angelegt.</span>}
        </div>

        <div className="palette-gruppe palette-werkzeuge">
          <button
            type="button"
            className={`palette-item palette-radierer${werkzeug?.art === "radierer" ? " aktiv" : ""}`}
            title="Zugewiesene Schicht durch Klick auf das Kürzel entfernen"
            onClick={() => setWerkzeug({ art: "radierer" })}
          >
            Radierer
          </button>
          <button type="button" className="palette-item palette-aufheben" disabled={!werkzeug} onClick={() => setWerkzeug(null)}>
            × Auswahl aufheben
          </button>
        </div>

        <span className="hint">
          {werkzeug?.art === "schichtart" &&
            `„${werkzeug.schichtart.bezeichnung}" ausgewählt – Zellen anklicken oder durch Ziehen mehrere Tage auf einmal zuweisen.`}
          {werkzeug?.art === "vorlage" &&
            `„${werkzeug.vorlage.bezeichnung}" ausgewählt – Zelle anklicken, sie ist der erste Tag des Blocks.`}
          {werkzeug?.art === "radierer" &&
            "Radierer aktiv – Kürzel anklicken oder über mehrere Zellen ziehen, um Zuweisungen zu entfernen."}
          {!werkzeug &&
            "Werkzeug wählen, um Schichten zuzuweisen. Ohne Werkzeug öffnet ein Klick auf ein Kürzel oder eine Freischicht die Details."}
        </span>
      </div>

      <div className="plantafel-scroll">
        <table
          className={`table plantafel${werkzeug ? " stempel-aktiv" : ""}${dragAktiv ? " ziehen-aktiv" : ""}`}
          onDragStart={(e) => e.preventDefault()}
        >
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              {tage.map((t, i) => {
                const klassen = [istWochenende(t) ? "wochenende" : "", feiertage.has(t) ? "feiertag" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <th key={t} className={klassen}>
                    <div className="tag-nr">{formatDatum(t).slice(0, 5)}</div>
                    <div className="tag-wt">{WOCHENTAGE_KURZ[i]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {mitarbeiter.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                {tage.map((t) => {
                  const treffer = zellenZuweisungen(m.id, t);
                  const klassen = [
                    "plan-zelle",
                    istWochenende(t) ? "wochenende" : "",
                    feiertage.has(t) ? "feiertag" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const wirdGezogen = dragZellenRef.current.has(`${m.id}|${t}`);
                  return (
                    <td
                      key={t}
                      className={`${klassen}${wirdGezogen ? " ziehen-markiert" : ""}`}
                      onMouseDown={() => zelleMouseDown(m.id, t)}
                      onMouseEnter={() => zelleMouseEnter(m.id, t)}
                    >
                      {treffer.length > 0 ? (
                        treffer.map((z) => {
                          const sa = schichtarten.find((s) => s.id === z.schichtart_id);
                          if (!sa) return null;
                          const anzahlKommentare = kommentareFuer(z.id).length;
                          return (
                            <span
                              key={z.id}
                              className={`badge${z.status === "entwurf" ? " badge-entwurf" : ""}`}
                              style={{ background: sa.farbe }}
                              title={`${sa.bezeichnung} (${z.status})${anzahlKommentare > 0 ? ` · ${anzahlKommentare} Kommentar(e)` : ""}`}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                zelleMouseDown(z.benutzer_id, z.datum);
                              }}
                              onMouseEnter={(e) => {
                                e.stopPropagation();
                                zelleMouseEnter(z.benutzer_id, z.datum);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                badgeKlick(z);
                              }}
                            >
                              {sa.kuerzel}
                              {anzahlKommentare > 0 && <span className="kommentar-marker" />}
                            </span>
                          );
                        })
                      ) : (
                        (() => {
                          const freiKommentare = freischichtKommentareFuer(m.id, t);
                          return (
                            <span
                              className="freischicht-hinweis"
                              title={freiKommentare.length > 0 ? `${freiKommentare.length} Kommentar(e)` : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                freiKlick(m.id, t);
                              }}
                            >
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

      <p className="hint">
        Legende: gestrichelter Rahmen = Entwurf, ohne Rahmen = veröffentlicht. Punkt am Kürzel = Kommentar vorhanden.
        Wochenenden grau, Feiertage gelb hinterlegt.
      </p>

      {detailZuweisung && (
        <ZuweisungDetail
          zuweisung={detailZuweisung}
          schichtart={schichtarten.find((s) => s.id === detailZuweisung.schichtart_id)}
          mitarbeiterName={mitarbeiter.find((m) => m.id === detailZuweisung.benutzer_id)?.name ?? ""}
          kommentare={kommentareFuer(detailZuweisung.id)}
          onSchliessen={() => setDetailId(null)}
          onGeaendert={load}
          onLoeschen={() => zuweisungLoeschen(detailZuweisung)}
        />
      )}

      {freischichtDetail && (
        <FreischichtDetail
          benutzerId={freischichtDetail.benutzerId}
          datum={freischichtDetail.datum}
          planungseinheitId={peId!}
          mitarbeiterName={mitarbeiter.find((m) => m.id === freischichtDetail.benutzerId)?.name ?? ""}
          kommentare={freischichtKommentareFuer(freischichtDetail.benutzerId, freischichtDetail.datum)}
          onSchliessen={() => setFreischichtDetail(null)}
          onGeaendert={load}
        />
      )}
    </div>
  );
}

// Detailfenster einer Zuweisung: Kommentare lesen, anlegen (oeffentlich oder nur fuer Planer)
// und loeschen, sowie die Zuweisung selbst entfernen.
function ZuweisungDetail({
  zuweisung,
  schichtart,
  mitarbeiterName,
  kommentare,
  onSchliessen,
  onGeaendert,
  onLoeschen,
}: {
  zuweisung: Zuweisung;
  schichtart?: Schichtart;
  mitarbeiterName: string;
  kommentare: Kommentar[];
  onSchliessen: () => void;
  onGeaendert: () => void;
  onLoeschen: () => void;
}) {
  const [text, setText] = useState("");
  const [sichtbarkeit, setSichtbarkeit] = useState<"oeffentlich" | "nur_planer">("nur_planer");
  const [fehler, setFehler] = useState<string | null>(null);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setFehler(null);
    try {
      await api(`/zuweisungen/${zuweisung.id}/kommentare`, {
        method: "POST",
        body: JSON.stringify({ text, sichtbarkeit }),
      });
      setText("");
      onGeaendert();
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  async function kommentarLoeschen(id: number) {
    await api(`/kommentare/${id}`, { method: "DELETE" });
    onGeaendert();
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onSchliessen} />
      <div className="popover">
        <div className="popover-kopf">
          <div>
            {schichtart && (
              <span className="badge" style={{ background: schichtart.farbe }}>
                {schichtart.kuerzel}
              </span>
            )}{" "}
            <strong>{schichtart?.bezeichnung}</strong>
            <div className="hint">
              {mitarbeiterName} · {formatDatum(zuweisung.datum)}{" "}
              <span className={`status status-${zuweisung.status}`}>
                {zuweisung.status === "entwurf" ? "Entwurf" : "Veröffentlicht"}
              </span>
            </div>
          </div>
          <button type="button" className="popover-schliessen" onClick={onSchliessen} title="Schließen">
            ×
          </button>
        </div>

        <div className="kommentar-liste">
          {kommentare.length === 0 && <p className="empty">Noch keine Kommentare.</p>}
          {kommentare.map((k) => (
            <div key={k.id} className="kommentar-eintrag">
              <div className="kommentar-meta">
                <span>
                  {k.autor_name} · {formatDatumZeit(k.erstellt_am)}
                </span>
                <span className={`sichtbarkeit-chip${k.sichtbarkeit === "nur_planer" ? " sichtbarkeit-nur-planer" : ""}`}>
                  {k.sichtbarkeit === "nur_planer" ? "Nur Planer" : "Öffentlich"}
                </span>
                <button type="button" onClick={() => kommentarLoeschen(k.id)} title="Kommentar löschen">
                  ×
                </button>
              </div>
              <div>{k.text}</div>
            </div>
          ))}
        </div>

        <form onSubmit={anlegen} className="kommentar-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Kommentar…" rows={2} />
          <div className="zeile">
            <select value={sichtbarkeit} onChange={(e) => setSichtbarkeit(e.target.value as "oeffentlich" | "nur_planer")}>
              <option value="nur_planer">Nur Planer</option>
              <option value="oeffentlich">Öffentlich</option>
            </select>
            <button type="submit" disabled={!text.trim()}>
              Kommentar speichern
            </button>
          </div>
        </form>
        {fehler && <div className="error">{fehler}</div>}

        <div className="popover-fuss">
          <button type="button" onClick={onLoeschen}>
            Zuweisung löschen
          </button>
        </div>
      </div>
    </>
  );
}

// Detailfenster einer Freischicht (Tag ohne Zuweisung): auch hier koennen Planer Kommentare
// hinterlegen -- z. B. um zu vermerken, warum bewusst niemand eingeteilt ist. Ohne
// "Zuweisung loeschen", da es keine Zuweisung gibt.
function FreischichtDetail({
  benutzerId,
  datum,
  planungseinheitId,
  mitarbeiterName,
  kommentare,
  onSchliessen,
  onGeaendert,
}: {
  benutzerId: number;
  datum: string;
  planungseinheitId: number;
  mitarbeiterName: string;
  kommentare: FreischichtKommentar[];
  onSchliessen: () => void;
  onGeaendert: () => void;
}) {
  const [text, setText] = useState("");
  const [sichtbarkeit, setSichtbarkeit] = useState<"oeffentlich" | "nur_planer">("nur_planer");
  const [fehler, setFehler] = useState<string | null>(null);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setFehler(null);
    try {
      await api("/freischicht-kommentare", {
        method: "POST",
        body: JSON.stringify({ benutzerId, datum, planungseinheitId, text, sichtbarkeit }),
      });
      setText("");
      onGeaendert();
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  async function kommentarLoeschen(id: number) {
    await api(`/freischicht-kommentare/${id}`, { method: "DELETE" });
    onGeaendert();
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onSchliessen} />
      <div className="popover">
        <div className="popover-kopf">
          <div>
            <strong>Freischicht</strong>
            <div className="hint">
              {mitarbeiterName} · {formatDatum(datum)}
            </div>
          </div>
          <button type="button" className="popover-schliessen" onClick={onSchliessen} title="Schließen">
            ×
          </button>
        </div>

        <div className="kommentar-liste">
          {kommentare.length === 0 && <p className="empty">Noch keine Kommentare.</p>}
          {kommentare.map((k) => (
            <div key={k.id} className="kommentar-eintrag">
              <div className="kommentar-meta">
                <span>
                  {k.autor_name} · {formatDatumZeit(k.erstellt_am)}
                </span>
                <span className={`sichtbarkeit-chip${k.sichtbarkeit === "nur_planer" ? " sichtbarkeit-nur-planer" : ""}`}>
                  {k.sichtbarkeit === "nur_planer" ? "Nur Planer" : "Öffentlich"}
                </span>
                <button type="button" onClick={() => kommentarLoeschen(k.id)} title="Kommentar löschen">
                  ×
                </button>
              </div>
              <div>{k.text}</div>
            </div>
          ))}
        </div>

        <form onSubmit={anlegen} className="kommentar-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Kommentar…" rows={2} />
          <div className="zeile">
            <select value={sichtbarkeit} onChange={(e) => setSichtbarkeit(e.target.value as "oeffentlich" | "nur_planer")}>
              <option value="nur_planer">Nur Planer</option>
              <option value="oeffentlich">Öffentlich</option>
            </select>
            <button type="submit" disabled={!text.trim()}>
              Kommentar speichern
            </button>
          </div>
        </form>
        {fehler && <div className="error">{fehler}</div>}
      </div>
    </>
  );
}
