import { Fragment, FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import RasterMatrix, {
  RasterSpalte,
  RasterSummen,
  RasterZeile,
  unerfuellteVorgabenText,
  unbeantworteteAngeboteText,
} from "../components/RasterMatrix";
import TerminListe from "../components/TerminListe";
import { formatDatum, formatDatumZeit, parseDatum } from "../lib/datum";

interface Ausschreibung {
  id: number;
  titel: string;
  zeitraum_von: string;
  zeitraum_bis: string;
  bewerbungsfrist: string;
  status: string;
  sichtbarkeit: string;
}

interface RasterResponse {
  ausschreibung: Ausschreibung;
  spalten: RasterSpalte[];
  zeilen: RasterZeile[];
  summen: RasterSummen;
  // Ausschreibungen sind nicht mehr an genau eine Planungseinheit gebunden (siehe
  // ausschreibung_team) -- ob der Nutzer Planer ist, liefert der Server daher direkt mit.
  istPlaner: boolean;
}

interface Schichtart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
}

interface Bereitschaftsart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
}

interface Teilnehmer {
  id: number;
  name: string;
  email: string | null;
  token: string;
  benutzer_id: number | null;
  wunsch_anzahl: number | null;
  abgegeben_am: string | null;
  eingeladen_am: string | null;
  erinnert_am: string | null;
}

interface Terminserie {
  id: number;
  bezeichnung: string;
  anzahlBloecke: number;
  mindest_zusagen: number | null;
}

interface Gruppe {
  id: number;
  bezeichnung: string;
  mindest_zusagen: number | null;
  mitglieder: { id: number; bezeichnung: string }[];
}

interface Uebersicht {
  standard: number | null;
  teilnehmer: { teilnehmerId: number; name: string; override: number | null }[];
}

interface VorschlagBlock {
  schichtblockId: number;
  bezeichnung: string;
  bedarf: number;
  vorgeschlagen: number[];
  begruendung: string[];
}

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

type Tab = "raster" | "generator" | "teilnehmer" | "fortschritt" | "vergabe";

// Individuelle Mindestanzahl je Teilnehmer -- fuer eine einzelne Terminserie und fuer eine
// Gruppe aus mehreren Serien identisch aufgebaut (Standard der Serie/Gruppe als Platzhalter,
// ueberschreibbar je Person).
function MindestzusagenTabelle({ uebersicht, onAendern }: { uebersicht: Uebersicht; onAendern: (teilnehmerId: number, wert: number | "") => void }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Mindestanzahl (Standard: {uebersicht.standard ?? "keine"})</th>
        </tr>
      </thead>
      <tbody>
        {uebersicht.teilnehmer.map((t) => (
          <tr key={t.teilnehmerId}>
            <td>{t.name}</td>
            <td>
              <input
                type="number"
                min={0}
                defaultValue={t.override ?? ""}
                placeholder={uebersicht.standard != null ? String(uebersicht.standard) : "keine"}
                onBlur={(e) => {
                  const wert = e.target.value ? Number(e.target.value) : "";
                  if (wert !== (t.override ?? "")) onAendern(t.teilnehmerId, wert);
                }}
              />
            </td>
          </tr>
        ))}
        {uebersicht.teilnehmer.length === 0 && (
          <tr>
            <td colSpan={2} className="empty">
              Noch keine Teilnehmer.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function JahresabfragePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [raster, setRaster] = useState<RasterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("raster");

  const istPlaner = raster?.istPlaner ?? false;

  function ladeRaster() {
    api<RasterResponse>(`/ausschreibungen/${id}/raster`)
      .then(setRaster)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(ladeRaster, [id]);

  async function eigeneAntwort(schichtblockId: number, antwort: string) {
    const res = await api<{ ok: boolean; warnungen: Record<number, { meldung: string }[]> }>(`/ausschreibungen/${id}/antworten`, {
      method: "PUT",
      body: JSON.stringify({ antworten: [{ schichtblockId, antwort }] }),
    });
    ladeRaster();
    return (res.warnungen?.[schichtblockId] ?? []).map((w) => w.meldung);
  }

  if (error) return <div className="page error">{error}</div>;
  if (!raster) return <div className="center-info">Lade…</div>;

  const eigeneZeile = raster.zeilen.find((z) => z.benutzerId === user?.id);

  return (
    <div className="page">
      <h1>{raster.ausschreibung.titel}</h1>
      <p className="hint">
        Zeitraum {formatDatum(raster.ausschreibung.zeitraum_von)} – {formatDatum(raster.ausschreibung.zeitraum_bis)} · Frist{" "}
        {formatDatumZeit(raster.ausschreibung.bewerbungsfrist)} ·{" "}
        <span className={`status status-${raster.ausschreibung.status}`}>{raster.ausschreibung.status}</span>
      </p>

      {istPlaner && (
        <div className="toolbar">
          <button onClick={() => setTab("raster")} disabled={tab === "raster"}>
            Raster
          </button>
          <button onClick={() => setTab("generator")} disabled={tab === "generator"}>
            Termingenerator
          </button>
          <button onClick={() => setTab("teilnehmer")} disabled={tab === "teilnehmer"}>
            Teilnehmer
          </button>
          <button onClick={() => setTab("fortschritt")} disabled={tab === "fortschritt"}>
            Fortschritt
          </button>
          <button onClick={() => setTab("vergabe")} disabled={tab === "vergabe"}>
            Vergabevorschlag
          </button>
          <a href={`/api/ausschreibungen/${id}/export.csv`} target="_blank" rel="noreferrer">
            CSV-Export
          </a>
        </div>
      )}

      {istPlaner && tab === "raster" && <RasterMatrix spalten={raster.spalten} zeilen={raster.zeilen} summen={raster.summen} />}
      {istPlaner && tab === "generator" && <GeneratorTab ausschreibungId={Number(id)} onErzeugt={ladeRaster} />}
      {istPlaner && tab === "teilnehmer" && <TeilnehmerTab ausschreibungId={Number(id)} onGeaendert={ladeRaster} />}
      {istPlaner && tab === "fortschritt" && <FortschrittTab ausschreibungId={Number(id)} />}
      {istPlaner && tab === "vergabe" && <VergabeTab ausschreibungId={Number(id)} onVergeben={ladeRaster} />}

      {!istPlaner && (
        <>
          <h2>Meine Antworten</h2>
          {eigeneZeile && eigeneZeile.unbeantwortet.length > 0 && (
            <p className="raster-gesperrt-hinweis">
              Bitte für jedes Angebot eine Rückmeldung geben – noch offen: {unbeantworteteAngeboteText(eigeneZeile.unbeantwortet, raster.spalten)}.
            </p>
          )}
          {eigeneZeile && eigeneZeile.vorgaben.length > 0 && (
            <p className={eigeneZeile.vollstaendig ? "hint" : "raster-gesperrt-hinweis"}>
              {eigeneZeile.vollstaendig
                ? "Danke, du hast alle Mindestanzahlen erreicht."
                : `Bitte noch für folgende Termine mit „Ja" antworten: ${unerfuellteVorgabenText(eigeneZeile.vorgaben)}.`}
            </p>
          )}
          <TerminListe spalten={raster.spalten} zellen={eigeneZeile?.zellen ?? {}} onAntwort={eigeneAntwort} />
        </>
      )}
    </div>
  );
}

function GeneratorTab({ ausschreibungId, onErzeugt }: { ausschreibungId: number; onErzeugt: () => void }) {
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [bereitschaftsarten, setBereitschaftsarten] = useState<Bereitschaftsart[]>([]);
  const [serien, setSerien] = useState<Terminserie[]>([]);
  const [bezeichnung, setBezeichnung] = useState("");
  const [typ, setTyp] = useState<"woechentlich" | "monatlich" | "feiertage" | "einzeln">("woechentlich");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [wochentage, setWochentage] = useState<number[]>([5, 6]);
  const [woche, setWoche] = useState(1);
  const [daten, setDaten] = useState("");
  const [gruppierung, setGruppierung] = useState<"pro_termin" | "pro_woche">("pro_woche");
  const [beachteFeiertage, setBeachteFeiertage] = useState(false);
  // Eine Terminserie ist ganz Schicht- oder ganz Bereitschafts-basiert (kein Mischen) -- siehe
  // lib/db.ts (blockschicht) und routes/jahresabfrage.ts.
  const [serienTyp, setSerienTyp] = useState<"schicht" | "bereitschaft">("schicht");
  const [schichtartId, setSchichtartId] = useState<number | null>(null);
  const [bereitschaftsartId, setBereitschaftsartId] = useState<number | null>(null);
  const [personenBedarf, setPersonenBedarf] = useState(1);
  const [mindestZusagen, setMindestZusagen] = useState<number | "">("");
  const [vorschau, setVorschau] = useState<{ anzahlTermine: number; anzahlBloecke: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [offeneUebersichtSid, setOffeneUebersichtSid] = useState<number | null>(null);
  const [uebersicht, setUebersicht] = useState<Uebersicht | null>(null);

  const [gruppen, setGruppen] = useState<Gruppe[]>([]);
  const [gruppeBezeichnung, setGruppeBezeichnung] = useState("");
  const [gruppeMindestZusagen, setGruppeMindestZusagen] = useState<number | "">("");
  const [gruppeAusgewaehlt, setGruppeAusgewaehlt] = useState<number[]>([]);
  const [offeneGruppenUebersichtGid, setOffeneGruppenUebersichtGid] = useState<number | null>(null);
  const [gruppenUebersicht, setGruppenUebersicht] = useState<Uebersicht | null>(null);

  function ladeSerien() {
    api<Terminserie[]>(`/ausschreibungen/${ausschreibungId}/terminserien`).then(setSerien);
  }

  function ladeGruppen() {
    api<Gruppe[]>(`/ausschreibungen/${ausschreibungId}/gruppen`).then(setGruppen);
  }

  useEffect(() => {
    api<Schichtart[]>("/schichtarten").then((s) => {
      setSchichtarten(s);
      if (s[0]) setSchichtartId(s[0].id);
    });
    api<Bereitschaftsart[]>("/bereitschaftsarten").then((b) => {
      setBereitschaftsarten(b);
      if (b[0]) setBereitschaftsartId(b[0].id);
    });
    ladeSerien();
    ladeGruppen();
  }, [ausschreibungId]);

  function regelPayload() {
    if (typ === "einzeln") {
      return { typ, daten: daten.split(",").map((d) => parseDatum(d)).filter(Boolean), beachteFeiertage };
    }
    if (typ === "feiertage") {
      return { typ, von, bis };
    }
    if (typ === "monatlich") {
      return { typ, von, bis, wochentage, woche, beachteFeiertage };
    }
    return { typ, von, bis, wochentage, beachteFeiertage };
  }

  async function vorschauLaden() {
    setError(null);
    try {
      const res = await api<{ anzahlTermine: number; anzahlBloecke: number }>(`/ausschreibungen/${ausschreibungId}/terminserien/vorschau`, {
        method: "POST",
        body: JSON.stringify({ regel: regelPayload(), gruppierung, bezeichnung: bezeichnung || "Termin" }),
      });
      setVorschau(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function erzeugen(e: FormEvent) {
    e.preventDefault();
    const gewaehlteId = serienTyp === "bereitschaft" ? bereitschaftsartId : schichtartId;
    if (!gewaehlteId) return;
    setBusy(true);
    setError(null);
    try {
      const ids =
        wochentage.length > 0 && (typ === "woechentlich" || typ === "monatlich") ? wochentage.map(() => gewaehlteId) : [gewaehlteId];
      await api(`/ausschreibungen/${ausschreibungId}/terminserien`, {
        method: "POST",
        body: JSON.stringify({
          bezeichnung: bezeichnung || "Termin",
          regel: regelPayload(),
          gruppierung,
          ...(serienTyp === "bereitschaft" ? { bereitschaftsartIds: ids } : { schichtartIds: ids }),
          personenBedarf,
          mindestZusagen: mindestZusagen || undefined,
        }),
      });
      setVorschau(null);
      setMindestZusagen("");
      ladeSerien();
      onErzeugt();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loeschen(sid: number) {
    await api(`/ausschreibungen/${ausschreibungId}/terminserien/${sid}`, { method: "DELETE" });
    ladeSerien();
    onErzeugt();
  }

  async function mindestZusagenAendern(sid: number, wert: number | "") {
    await api(`/ausschreibungen/${ausschreibungId}/terminserien/${sid}`, {
      method: "PUT",
      body: JSON.stringify({ mindestZusagen: wert === "" ? null : wert }),
    });
    ladeSerien();
    onErzeugt();
  }

  async function uebersichtOeffnen(sid: number) {
    if (offeneUebersichtSid === sid) {
      setOffeneUebersichtSid(null);
      setUebersicht(null);
      return;
    }
    const res = await api<Uebersicht>(`/ausschreibungen/${ausschreibungId}/terminserien/${sid}/mindestzusagen`);
    setUebersicht(res);
    setOffeneUebersichtSid(sid);
  }

  async function overrideAendern(sid: number, teilnehmerId: number, wert: number | "") {
    await api(`/ausschreibungen/${ausschreibungId}/terminserien/${sid}/mindestzusagen/${teilnehmerId}`, {
      method: "PUT",
      body: JSON.stringify({ mindestZusagen: wert === "" ? null : wert }),
    });
    const res = await api<Uebersicht>(`/ausschreibungen/${ausschreibungId}/terminserien/${sid}/mindestzusagen`);
    setUebersicht(res);
    onErzeugt();
  }

  async function gruppeAnlegen(e: FormEvent) {
    e.preventDefault();
    if (gruppeAusgewaehlt.length < 2) {
      setError("Eine Gruppe braucht mindestens zwei Terminserien.");
      return;
    }
    setError(null);
    try {
      await api(`/ausschreibungen/${ausschreibungId}/gruppen`, {
        method: "POST",
        body: JSON.stringify({
          bezeichnung: gruppeBezeichnung,
          terminserieIds: gruppeAusgewaehlt,
          mindestZusagen: gruppeMindestZusagen || undefined,
        }),
      });
      setGruppeBezeichnung("");
      setGruppeMindestZusagen("");
      setGruppeAusgewaehlt([]);
      ladeGruppen();
      onErzeugt();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function gruppeMindestZusagenAendern(gid: number, wert: number | "") {
    await api(`/ausschreibungen/${ausschreibungId}/gruppen/${gid}`, {
      method: "PUT",
      body: JSON.stringify({ mindestZusagen: wert === "" ? null : wert }),
    });
    ladeGruppen();
    onErzeugt();
  }

  async function gruppeLoeschen(gid: number) {
    await api(`/ausschreibungen/${ausschreibungId}/gruppen/${gid}`, { method: "DELETE" });
    ladeGruppen();
    onErzeugt();
  }

  async function gruppenUebersichtOeffnen(gid: number) {
    if (offeneGruppenUebersichtGid === gid) {
      setOffeneGruppenUebersichtGid(null);
      setGruppenUebersicht(null);
      return;
    }
    const res = await api<Uebersicht>(`/ausschreibungen/${ausschreibungId}/gruppen/${gid}/mindestzusagen`);
    setGruppenUebersicht(res);
    setOffeneGruppenUebersichtGid(gid);
  }

  async function gruppenOverrideAendern(gid: number, teilnehmerId: number, wert: number | "") {
    await api(`/ausschreibungen/${ausschreibungId}/gruppen/${gid}/mindestzusagen/${teilnehmerId}`, {
      method: "PUT",
      body: JSON.stringify({ mindestZusagen: wert === "" ? null : wert }),
    });
    const res = await api<Uebersicht>(`/ausschreibungen/${ausschreibungId}/gruppen/${gid}/mindestzusagen`);
    setGruppenUebersicht(res);
    onErzeugt();
  }

  return (
    <div>
      <form className="card form-inline" onSubmit={erzeugen}>
        <h2>Terminserie anlegen</h2>
        <label>
          Bezeichnung
          <input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} placeholder="z. B. Wochenende Frühschicht" />
        </label>
        <label>
          Regeltyp
          <select value={typ} onChange={(e) => setTyp(e.target.value as typeof typ)}>
            <option value="woechentlich">Wöchentlich</option>
            <option value="monatlich">Monatlich (n-ter Wochentag)</option>
            <option value="feiertage">Feiertage NRW</option>
            <option value="einzeln">Einzelne Termine</option>
          </select>
        </label>
        {typ !== "einzeln" && (
          <>
            <label>
              Von
              <input type="date" value={von} onChange={(e) => setVon(e.target.value)} required />
            </label>
            <label>
              Bis
              <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} required />
            </label>
          </>
        )}
        {(typ === "woechentlich" || typ === "monatlich") && (
          <div className="wochentage-auswahl">
            {WOCHENTAGE.map((w, i) => (
              <label key={i} className="wochentag-checkbox">
                <input
                  type="checkbox"
                  checked={wochentage.includes(i)}
                  onChange={(e) =>
                    setWochentage(e.target.checked ? [...wochentage, i].sort() : wochentage.filter((x) => x !== i))
                  }
                />
                {w}
              </label>
            ))}
          </div>
        )}
        {typ === "monatlich" && (
          <label>
            Woche im Monat
            <select value={woche} onChange={(e) => setWoche(Number(e.target.value))}>
              <option value={1}>1.</option>
              <option value={2}>2.</option>
              <option value={3}>3.</option>
              <option value={4}>4.</option>
              <option value={-1}>letzte</option>
            </select>
          </label>
        )}
        {typ === "einzeln" && (
          <label>
            Termine (Komma-getrennt, TT.MM.JJJJ)
            <input value={daten} onChange={(e) => setDaten(e.target.value)} placeholder="24.12.2027, 31.12.2027" />
          </label>
        )}
        <label>
          Gruppierung
          <select value={gruppierung} onChange={(e) => setGruppierung(e.target.value as typeof gruppierung)}>
            <option value="pro_termin">Ein Block je Termin</option>
            <option value="pro_woche">Block je Kalenderwoche (z. B. Sa+So)</option>
          </select>
        </label>
        {typ !== "feiertage" && (
          <label className="wochentag-checkbox">
            <input type="checkbox" checked={beachteFeiertage} onChange={(e) => setBeachteFeiertage(e.target.checked)} />
            Feiertage nicht anbieten (z. B. klassische Tagschicht)
          </label>
        )}
        <label>
          Serientyp
          <select value={serienTyp} onChange={(e) => setSerienTyp(e.target.value as typeof serienTyp)}>
            <option value="schicht">Schicht</option>
            <option value="bereitschaft">Bereitschaft</option>
          </select>
        </label>
        {serienTyp === "schicht" ? (
          <label>
            Schichtart
            <select value={schichtartId ?? ""} onChange={(e) => setSchichtartId(Number(e.target.value))}>
              {schichtarten.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kuerzel} – {s.bezeichnung}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Bereitschaftsart
            <select value={bereitschaftsartId ?? ""} onChange={(e) => setBereitschaftsartId(Number(e.target.value))}>
              {bereitschaftsarten.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.kuerzel} – {b.bezeichnung}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Personen-Bedarf
          <input type="number" min={1} value={personenBedarf} onChange={(e) => setPersonenBedarf(Number(e.target.value))} />
        </label>
        <label>
          Mindestanzahl Zusagen für diese Serie
          <input
            type="number"
            min={0}
            value={mindestZusagen}
            onChange={(e) => setMindestZusagen(e.target.value ? Number(e.target.value) : "")}
            placeholder="optional"
          />
        </label>
        <button type="button" onClick={vorschauLaden}>
          Vorschau
        </button>
        <button type="submit" disabled={busy}>
          Termine erzeugen
        </button>
        {vorschau && (
          <p className="hint">
            Vorschau: {vorschau.anzahlTermine} Termine, {vorschau.anzahlBloecke} Blöcke
          </p>
        )}
        <p className="hint">
          Die Mindestanzahl gilt je Serie, nicht für die ganze Jahresabfrage -- z. B. „mind. 3" für Wochenende Frühschicht und
          getrennt davon „mind. 2" für Nachtschicht-4er-Blöcke. Erst wenn alle so konfigurierten Serien erfüllt sind, gilt die
          Rückmeldung eines Teilnehmers als vollständig. Über „Je Mitarbeiter" lässt sich die Mindestanzahl einer Serie
          zusätzlich für einzelne Personen abweichend festlegen (z. B. weniger Nachtschichten für Teilzeitkräfte).
        </p>
        {error && <div className="error">{error}</div>}
      </form>

      <h2>Angelegte Terminserien</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>Blöcke</th>
            <th>Mindestanzahl Zusagen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {serien.map((s) => (
            <Fragment key={s.id}>
              <tr>
                <td>{s.bezeichnung}</td>
                <td>{s.anzahlBloecke}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    defaultValue={s.mindest_zusagen ?? ""}
                    placeholder="keine"
                    onBlur={(e) => {
                      const wert = e.target.value ? Number(e.target.value) : "";
                      if (wert !== (s.mindest_zusagen ?? "")) mindestZusagenAendern(s.id, wert);
                    }}
                  />
                </td>
                <td>
                  <button onClick={() => uebersichtOeffnen(s.id)}>Je Mitarbeiter</button>
                  <button onClick={() => loeschen(s.id)}>Löschen</button>
                </td>
              </tr>
              {offeneUebersichtSid === s.id && uebersicht && (
                <tr>
                  <td colSpan={4}>
                    <MindestzusagenTabelle uebersicht={uebersicht} onAendern={(tid, wert) => overrideAendern(s.id, tid, wert)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {serien.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">
                Noch keine Terminserie angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Gruppen (mehrere Serien mit gemeinsamer Mindestanzahl)</h2>
      <p className="hint">
        Fasst mehrere Terminserien zu einer Gruppe zusammen, z. B. „Wochenenddienste" aus den Serien Frühschicht und
        Spätschicht mit einer gemeinsamen Mindestanzahl (z. B. mind. 3 insgesamt, egal in welcher Kombination). Gilt
        zusätzlich zu den Mindestanzahlen der einzelnen Serien, nicht statt ihnen.
      </p>
      <form className="card form-inline" onSubmit={gruppeAnlegen}>
        <label>
          Bezeichnung
          <input value={gruppeBezeichnung} onChange={(e) => setGruppeBezeichnung(e.target.value)} required placeholder="z. B. Wochenenddienste" />
        </label>
        <div className="wochentage-auswahl">
          {serien.map((s) => (
            <label key={s.id} className="wochentag-checkbox">
              <input
                type="checkbox"
                checked={gruppeAusgewaehlt.includes(s.id)}
                onChange={(e) =>
                  setGruppeAusgewaehlt(e.target.checked ? [...gruppeAusgewaehlt, s.id] : gruppeAusgewaehlt.filter((x) => x !== s.id))
                }
              />
              {s.bezeichnung}
            </label>
          ))}
        </div>
        <label>
          Mindestanzahl Zusagen für diese Gruppe
          <input
            type="number"
            min={0}
            value={gruppeMindestZusagen}
            onChange={(e) => setGruppeMindestZusagen(e.target.value ? Number(e.target.value) : "")}
            placeholder="optional"
          />
        </label>
        <button type="submit">Gruppe anlegen</button>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>Serien</th>
            <th>Mindestanzahl Zusagen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {gruppen.map((g) => (
            <Fragment key={g.id}>
              <tr>
                <td>{g.bezeichnung}</td>
                <td>{g.mitglieder.map((m) => m.bezeichnung).join(", ")}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    defaultValue={g.mindest_zusagen ?? ""}
                    placeholder="keine"
                    onBlur={(e) => {
                      const wert = e.target.value ? Number(e.target.value) : "";
                      if (wert !== (g.mindest_zusagen ?? "")) gruppeMindestZusagenAendern(g.id, wert);
                    }}
                  />
                </td>
                <td>
                  <button onClick={() => gruppenUebersichtOeffnen(g.id)}>Je Mitarbeiter</button>
                  <button onClick={() => gruppeLoeschen(g.id)}>Löschen</button>
                </td>
              </tr>
              {offeneGruppenUebersichtGid === g.id && gruppenUebersicht && (
                <tr>
                  <td colSpan={4}>
                    <MindestzusagenTabelle uebersicht={gruppenUebersicht} onAendern={(tid, wert) => gruppenOverrideAendern(g.id, tid, wert)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {gruppen.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">
                Noch keine Gruppe angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TeilnehmerTab({ ausschreibungId, onGeaendert }: { ausschreibungId: number; onGeaendert: () => void }) {
  const [teilnehmer, setTeilnehmer] = useState<Teilnehmer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [wunschAnzahl, setWunschAnzahl] = useState<number | "">("");
  const [links, setLinks] = useState<{ name: string; link: string }[] | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  function laden() {
    api<Teilnehmer[]>(`/ausschreibungen/${ausschreibungId}/teilnehmer`).then(setTeilnehmer);
  }
  useEffect(laden, [ausschreibungId]);

  async function ausMitarbeiternUebernehmen() {
    await api(`/ausschreibungen/${ausschreibungId}/teilnehmer`, { method: "POST", body: JSON.stringify({ ausMitarbeitern: true }) });
    laden();
    onGeaendert();
  }

  async function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    await api(`/ausschreibungen/${ausschreibungId}/teilnehmer`, {
      method: "POST",
      body: JSON.stringify({ teilnehmer: [{ name, email: email || undefined, wunschAnzahl: wunschAnzahl || undefined }] }),
    });
    setName("");
    setEmail("");
    setWunschAnzahl("");
    laden();
    onGeaendert();
  }

  async function einladen() {
    const res = await api<{ anzahl: number; links: { name: string; link: string }[] }>(`/ausschreibungen/${ausschreibungId}/einladen`, {
      method: "POST",
    });
    setLinks(res.links);
    setMeldung(`${res.anzahl} Einladung(en) verschickt.`);
    laden();
  }

  async function erinnern() {
    const res = await api<{ anzahlErinnert: number }>(`/ausschreibungen/${ausschreibungId}/erinnern`, { method: "POST" });
    setMeldung(`${res.anzahlErinnert} Person(en) erinnert.`);
    laden();
  }

  return (
    <div>
      <div className="actions">
        <button onClick={ausMitarbeiternUebernehmen}>Alle Mitarbeiter der Planungseinheit übernehmen</button>
        <button onClick={einladen}>Einladen (persönliche Links)</button>
        <button onClick={erinnern}>Ausstehende erinnern</button>
      </div>
      {meldung && <p className="hint">{meldung}</p>}

      <form className="card form-inline" onSubmit={hinzufuegen}>
        <h2>Teilnehmer hinzufügen</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          E-Mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Wunsch-Anzahl Dienste
          <input type="number" min={0} value={wunschAnzahl} onChange={(e) => setWunschAnzahl(e.target.value ? Number(e.target.value) : "")} />
        </label>
        <button type="submit">Hinzufügen</button>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Wunsch</th>
            <th>Link</th>
            <th>Eingeladen</th>
            <th>Abgegeben</th>
          </tr>
        </thead>
        <tbody>
          {teilnehmer.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.wunsch_anzahl ?? "–"}</td>
              <td>
                <code className="token-link">{`${window.location.origin}/abfrage/${t.token}`}</code>
              </td>
              <td>{t.eingeladen_am ? "ja" : "nein"}</td>
              <td>{t.abgegeben_am ? "ja" : "nein"}</td>
            </tr>
          ))}
          {teilnehmer.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Noch keine Teilnehmer.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {links && links.length > 0 && (
        <div className="card">
          <h3>Neu verschickte Links</h3>
          <ul>
            {links.map((l) => (
              <li key={l.link}>
                {l.name}: <code>{`${window.location.origin}${l.link}`}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FortschrittTab({ ausschreibungId }: { ausschreibungId: number }) {
  const [daten, setDaten] = useState<{
    gesamt: number;
    abgegeben: number;
    ausstehend: { id: number; name: string; vorgaben: { bezeichnung: string; zusagenAnzahl: number; mindestZusagen: number }[] }[];
    engpaesse: { schichtblockId: number; bezeichnung: string; bedarf: number; ja: number; wennNoetig: number; ampel: string }[];
  } | null>(null);

  useEffect(() => {
    api(`/ausschreibungen/${ausschreibungId}/fortschritt`).then(setDaten as any);
  }, [ausschreibungId]);

  if (!daten) return <div className="center-info">Lade…</div>;

  return (
    <div>
      <p>
        <strong>
          {daten.abgegeben} von {daten.gesamt}
        </strong>{" "}
        haben vollständig geantwortet.
      </p>
      <h2>Unvollständig</h2>
      <ul>
        {daten.ausstehend.map((a) => (
          <li key={a.id}>
            {a.name}
            {a.vorgaben.length > 0 &&
              ` – offen: ${a.vorgaben.map((v) => `${v.bezeichnung} (${v.zusagenAnzahl}/${v.mindestZusagen})`).join(", ")}`}
          </li>
        ))}
        {daten.ausstehend.length === 0 && <li className="empty">Alle haben vollständig geantwortet.</li>}
      </ul>
      <h2>Engpässe</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Termin</th>
            <th>Bedarf</th>
            <th>Ja</th>
            <th>Wenn nötig</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {daten.engpaesse.map((e) => (
            <tr key={e.schichtblockId}>
              <td>{e.bezeichnung}</td>
              <td>{e.bedarf}</td>
              <td>{e.ja}</td>
              <td>{e.wennNoetig}</td>
              <td className={`ampel ampel-${e.ampel}`}>{e.ampel}</td>
            </tr>
          ))}
          {daten.engpaesse.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Keine Engpässe.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function VergabeTab({ ausschreibungId, onVergeben }: { ausschreibungId: number; onVergeben: () => void }) {
  const [vorschlag, setVorschlag] = useState<{ seed: string; bloecke: VorschlagBlock[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function berechnen() {
    const res = await api<{ seed: string; bloecke: VorschlagBlock[] }>(`/ausschreibungen/${ausschreibungId}/vergabevorschlag`, {
      method: "POST",
    });
    setVorschlag(res);
  }

  async function uebernehmen(block: VorschlagBlock) {
    setBusy(block.schichtblockId);
    try {
      await api(`/schichtbloecke/${block.schichtblockId}/vergeben`, {
        method: "POST",
        body: JSON.stringify({ benutzerIds: block.vorgeschlagen, begruendung: "Vergabevorschlag Jahresabfrage" }),
      });
      onVergeben();
      berechnen();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <button onClick={berechnen}>Vergabevorschlag berechnen</button>
      {vorschlag && (
        <table className="table">
          <thead>
            <tr>
              <th>Termin</th>
              <th>Bedarf</th>
              <th>Vorschlag</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {vorschlag.bloecke.map((b) => (
              <tr key={b.schichtblockId}>
                <td>{b.bezeichnung}</td>
                <td>{b.bedarf}</td>
                <td>
                  {b.vorgeschlagen.length === 0 ? (
                    <span className="empty">niemand verfügbar</span>
                  ) : (
                    <ul>
                      {b.begruendung.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  {b.vorgeschlagen.length > 0 && (
                    <button disabled={busy === b.schichtblockId} onClick={() => uebernehmen(b)}>
                      Übernehmen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
