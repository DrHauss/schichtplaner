import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import RasterMatrix, { RasterSpalte, RasterSummen, RasterZeile, unerfuellteVorgabenText } from "../components/RasterMatrix";
import TerminListe from "../components/TerminListe";
import { formatDatum, formatDatumZeit, parseDatum } from "../lib/datum";

interface Ausschreibung {
  id: number;
  titel: string;
  planungseinheit_id: number;
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
}

interface Schichtart {
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

interface VorschlagBlock {
  schichtblockId: number;
  bezeichnung: string;
  bedarf: number;
  vorgeschlagen: number[];
  begruendung: string[];
}

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

type Tab = "raster" | "generator" | "teilnehmer" | "fortschritt" | "vergabe";

export default function JahresabfragePage() {
  const { id } = useParams();
  const { mitgliedschaften, user } = useAuth();
  const [raster, setRaster] = useState<RasterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("raster");

  const peId = raster?.ausschreibung.planungseinheit_id ?? null;
  const istPlaner = peId != null && (user?.istAdmin || mitgliedschaften.some((m) => m.rolle === "planer" && m.planungseinheit_id === peId));

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
      {istPlaner && tab === "generator" && <GeneratorTab ausschreibungId={Number(id)} peId={peId!} onErzeugt={ladeRaster} />}
      {istPlaner && tab === "teilnehmer" && <TeilnehmerTab ausschreibungId={Number(id)} onGeaendert={ladeRaster} />}
      {istPlaner && tab === "fortschritt" && <FortschrittTab ausschreibungId={Number(id)} />}
      {istPlaner && tab === "vergabe" && <VergabeTab ausschreibungId={Number(id)} onVergeben={ladeRaster} />}

      {!istPlaner && (
        <>
          <h2>Meine Antworten</h2>
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

function GeneratorTab({ ausschreibungId, peId, onErzeugt }: { ausschreibungId: number; peId: number; onErzeugt: () => void }) {
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [serien, setSerien] = useState<Terminserie[]>([]);
  const [bezeichnung, setBezeichnung] = useState("");
  const [typ, setTyp] = useState<"woechentlich" | "monatlich" | "feiertage" | "einzeln">("woechentlich");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [wochentage, setWochentage] = useState<number[]>([5, 6]);
  const [woche, setWoche] = useState(1);
  const [daten, setDaten] = useState("");
  const [gruppierung, setGruppierung] = useState<"pro_termin" | "pro_woche">("pro_woche");
  const [schichtartId, setSchichtartId] = useState<number | null>(null);
  const [personenBedarf, setPersonenBedarf] = useState(1);
  const [mindestZusagen, setMindestZusagen] = useState<number | "">("");
  const [vorschau, setVorschau] = useState<{ anzahlTermine: number; anzahlBloecke: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function ladeSerien() {
    api<Terminserie[]>(`/ausschreibungen/${ausschreibungId}/terminserien`).then(setSerien);
  }

  useEffect(() => {
    api<Schichtart[]>(`/planungseinheiten/${peId}/schichtarten`).then((s) => {
      setSchichtarten(s);
      if (s[0]) setSchichtartId(s[0].id);
    });
    ladeSerien();
  }, [peId]);

  function regelPayload() {
    if (typ === "einzeln") {
      return { typ, daten: daten.split(",").map((d) => parseDatum(d)).filter(Boolean) };
    }
    if (typ === "feiertage") {
      return { typ, von, bis };
    }
    if (typ === "monatlich") {
      return { typ, von, bis, wochentage, woche };
    }
    return { typ, von, bis, wochentage };
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
    if (!schichtartId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/ausschreibungen/${ausschreibungId}/terminserien`, {
        method: "POST",
        body: JSON.stringify({
          bezeichnung: bezeichnung || "Termin",
          regel: regelPayload(),
          gruppierung,
          schichtartIds: wochentage.length > 0 && (typ === "woechentlich" || typ === "monatlich") ? wochentage.map(() => schichtartId) : [schichtartId],
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
          Rückmeldung eines Teilnehmers als vollständig.
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
            <tr key={s.id}>
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
                <button onClick={() => loeschen(s.id)}>Löschen</button>
              </td>
            </tr>
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
