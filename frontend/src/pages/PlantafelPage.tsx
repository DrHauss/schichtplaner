import { FormEvent, useEffect, useMemo, useState } from "react";
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
}
interface Kommentar {
  id: number;
  zuweisung_id: number;
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
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([]);
  const [feiertage, setFeiertage] = useState<Set<string>>(new Set());
  const [werkzeug, setWerkzeug] = useState<Werkzeug | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tage = useMemo(() => wochenTage(woche), [woche]);

  function load() {
    if (!peId) return;
    api<{
      mitarbeiter: Mitarbeiter[];
      zuweisungen: Zuweisung[];
      schichtarten: Schichtart[];
      kommentare: Kommentar[];
    }>(`/planungseinheiten/${peId}/plantafel?von=${tage[0]}&bis=${tage[6]}`).then((d) => {
      setMitarbeiter(d.mitarbeiter);
      setZuweisungen(d.zuweisungen);
      setSchichtarten(d.schichtarten);
      setKommentare(d.kommentare ?? []);
    });
    api<Vorlage[]>(`/planungseinheiten/${peId}/schichtblock-vorlagen`).then(setVorlagen);
  }

  useEffect(() => {
    load();
    setDetailId(null);
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

  async function badgeKlick(z: Zuweisung) {
    if (busy) return;
    if (werkzeug?.art === "radierer") {
      setBusy(true);
      try {
        await api(`/zuweisungen/${z.id}`, { method: "DELETE" });
        load();
      } finally {
        setBusy(false);
      }
      return;
    }
    // Mit aktivem Stempel greift der Klick auf das Kuerzel wie ein Klick auf die Zelle durch
    // (das Badge verdeckt sonst die Zelle und eine belegte Zelle liesse sich nicht bestempeln).
    if (werkzeug) return zelleKlick(z.benutzer_id, z.datum);
    setDetailId(z.id);
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
        <span className="palette-label">Werkzeug</span>
        {schichtarten.map((sa) => (
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
        ))}
        {vorlagen.map((v) => (
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
        <button
          type="button"
          className={`palette-item palette-radierer${werkzeug?.art === "radierer" ? " aktiv" : ""}`}
          title="Zugewiesene Schicht durch Klick auf das Kürzel entfernen"
          onClick={() => setWerkzeug({ art: "radierer" })}
        >
          Radierer
        </button>
        {werkzeug && (
          <button type="button" className="palette-item" onClick={() => setWerkzeug(null)}>
            Auswahl aufheben
          </button>
        )}
        <span className="hint">
          {werkzeug?.art === "schichtart" &&
            `„${werkzeug.schichtart.bezeichnung}" ausgewählt – Zellen anklicken, um zuzuweisen.`}
          {werkzeug?.art === "vorlage" &&
            `„${werkzeug.vorlage.bezeichnung}" ausgewählt – Zelle anklicken, sie ist der erste Tag des Blocks.`}
          {werkzeug?.art === "radierer" && "Radierer aktiv – Kürzel anklicken, um die Zuweisung zu entfernen."}
          {!werkzeug && "Werkzeug wählen, um Schichten zuzuweisen. Ohne Werkzeug öffnet ein Klick auf ein Kürzel die Details."}
        </span>
      </div>

      <div className="plantafel-scroll">
        <table className={`table plantafel${werkzeug ? " stempel-aktiv" : ""}`}>
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
                  return (
                    <td key={t} className={klassen} onClick={() => zelleKlick(m.id, t)}>
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
                        <span className="freischicht-hinweis">frei</span>
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
