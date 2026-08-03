import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Schichtart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
  beginn: string;
  ende: string;
  farbe: string;
  kategorie: "dienst" | "abwesenheit";
  pause_min: number;
  stundenwert: number | null;
  ganztags: boolean;
}

// Zeitwert-Vorschlag aus Beginn/Ende/Pause -- der reine Vorschlag, keine Zwangs-Berechnung,
// da der tatsaechlich zustehende Pausenanspruch vom hier angenommenen pauseMin abweichen kann.
function zeitwertVorschlag(beginn: string, ende: string, pauseMin: number): number {
  const [bh, bm] = beginn.split(":").map(Number);
  const [eh, em] = ende.split(":").map(Number);
  let minuten = eh * 60 + em - (bh * 60 + bm);
  if (minuten <= 0) minuten += 24 * 60; // Schicht ueber Mitternacht
  minuten -= pauseMin;
  return Math.round((minuten / 60) * 4) / 4; // auf 0,25 Stunden gerundet
}

interface VorlageEintrag {
  id: number;
  tag_offset: number;
  schichtart_id: number;
  kuerzel: string;
  schichtart_bezeichnung: string;
}

interface Vorlage {
  id: number;
  bezeichnung: string;
  eintraege: VorlageEintrag[];
}

interface PlanungseinheitOption {
  id: number;
  name: string;
}

interface Planungseinheit {
  id: number;
  name: string;
  standort: string | null;
}

interface Mitgliedschaft {
  id: number;
  rolle: string;
  planungseinheit_id: number;
  planungseinheit_name: string;
}

interface Benutzer {
  id: number;
  email: string;
  name: string;
  personalnr: string | null;
  wochenstunden: number;
  soll_stunden_taeglich: number | null;
  ist_admin: number;
  mitgliedschaften: Mitgliedschaft[];
}

interface Arbeitstage {
  jahr: number;
  wochentageGesamt: number;
  feiertageAnWochentagen: number;
  arbeitstage: number;
}

interface FeiertagEintrag {
  id: number;
  jahr: number;
  datum: string;
  bezeichnung: string;
  istFrei: boolean;
  quelle: "generiert" | "manuell";
}

export default function StammdatenPage() {
  const { mitgliedschaften, user } = useAuth();
  const planerEinheiten = mitgliedschaften.filter((m) => m.rolle === "planer");
  const istAdmin = !!user?.istAdmin;

  const [alleEinheiten, setAlleEinheiten] = useState<Planungseinheit[]>([]);
  useEffect(() => {
    if (istAdmin) api<Planungseinheit[]>("/planungseinheiten").then(setAlleEinheiten);
  }, [istAdmin]);

  const einheitenOptionen: PlanungseinheitOption[] = istAdmin
    ? alleEinheiten.map((p) => ({ id: p.id, name: p.name }))
    : planerEinheiten.map((m) => ({ id: m.planungseinheit_id, name: m.planungseinheit_name }));

  const [peId, setPeId] = useState<number | null>(null);
  useEffect(() => {
    if (peId == null && einheitenOptionen.length > 0) setPeId(einheitenOptionen[0].id);
  }, [einheitenOptionen, peId]);

  if (!istAdmin && planerEinheiten.length === 0) {
    return <p className="empty">Keine Planer-Berechtigung.</p>;
  }

  return (
    <div className="page">
      <h1>Stammdaten</h1>

      {einheitenOptionen.length > 0 && (
        <SchichtartenSektion peId={peId} einheitenOptionen={einheitenOptionen} onPeChange={setPeId} />
      )}
      {peId != null && <SchichtblockVorlagenSektion peId={peId} />}
      {einheitenOptionen.length > 0 && <FeiertageSektion />}

      {istAdmin && <PlanungseinheitenSektion alleEinheiten={alleEinheiten} onGeaendert={() => api<Planungseinheit[]>("/planungseinheiten").then(setAlleEinheiten)} />}
      {istAdmin && <BenutzerverwaltungSektion alleEinheiten={alleEinheiten} />}
    </div>
  );
}

function SchichtartenSektion({
  peId,
  einheitenOptionen,
  onPeChange,
}: {
  peId: number | null;
  einheitenOptionen: PlanungseinheitOption[];
  onPeChange: (id: number) => void;
}) {
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [kuerzel, setKuerzel] = useState("");
  const [bezeichnung, setBezeichnung] = useState("");
  const [beginn, setBeginn] = useState("06:00");
  const [ende, setEnde] = useState("14:00");
  const [farbe, setFarbe] = useState("#3b82f6");
  const [kategorie, setKategorie] = useState<"dienst" | "abwesenheit">("dienst");
  const [ganztags, setGanztags] = useState(false);
  const [pauseMin, setPauseMin] = useState(0);
  const [stundenwert, setStundenwert] = useState<number | "">("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Schichtart | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (peId)
      api<Schichtart[]>(`/planungseinheiten/${peId}/schichtarten`).then((rows) =>
        setSchichtarten(rows.map((s) => ({ ...s, ganztags: !!s.ganztags })))
      );
  }

  useEffect(load, [peId]);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!peId) return;
    await api(`/planungseinheiten/${peId}/schichtarten`, {
      method: "POST",
      body: JSON.stringify({
        kuerzel,
        bezeichnung,
        beginn,
        ende,
        farbe,
        kategorie,
        ganztags,
        pauseMin,
        stundenwert: stundenwert === "" ? null : stundenwert,
      }),
    });
    setKuerzel("");
    setBezeichnung("");
    setGanztags(false);
    setPauseMin(0);
    setStundenwert("");
    load();
  }

  function bearbeitenStart(s: Schichtart) {
    setEditId(s.id);
    setEditForm({ ...s });
  }

  async function bearbeitenSpeichern() {
    if (!editForm) return;
    setError(null);
    try {
      await api(`/schichtarten/${editForm.id}`, {
        method: "PUT",
        body: JSON.stringify({
          kuerzel: editForm.kuerzel,
          bezeichnung: editForm.bezeichnung,
          beginn: editForm.beginn,
          ende: editForm.ende,
          farbe: editForm.farbe,
          kategorie: editForm.kategorie,
          ganztags: editForm.ganztags,
          pauseMin: editForm.pause_min,
          stundenwert: editForm.stundenwert,
        }),
      });
      setEditId(null);
      setEditForm(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Schichtarten</h2>
      {einheitenOptionen.length > 1 && (
        <select value={peId ?? ""} onChange={(e) => onPeChange(Number(e.target.value))}>
          {einheitenOptionen.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}

      <form className="card form-inline" onSubmit={anlegen}>
        <label>
          Kürzel
          <input value={kuerzel} onChange={(e) => setKuerzel(e.target.value)} required maxLength={4} />
        </label>
        <label>
          Bezeichnung
          <input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} required />
        </label>
        <label>
          <input
            type="checkbox"
            checked={ganztags}
            onChange={(e) => setGanztags(e.target.checked)}
            style={{ width: "auto" }}
          />{" "}
          Ganztägig
        </label>
        {!ganztags && (
          <>
            <label>
              Beginn
              <input type="time" value={beginn} onChange={(e) => setBeginn(e.target.value)} />
            </label>
            <label>
              Ende
              <input type="time" value={ende} onChange={(e) => setEnde(e.target.value)} />
            </label>
          </>
        )}
        <label>
          Pausenzeit (Min.)
          <input type="number" min={0} value={pauseMin} onChange={(e) => setPauseMin(Number(e.target.value))} />
        </label>
        <label>
          Zeitwert (Std.)
          <input
            type="number"
            step={0.25}
            min={0}
            value={stundenwert}
            placeholder="keiner"
            onChange={(e) => setStundenwert(e.target.value ? Number(e.target.value) : "")}
          />
        </label>
        {!ganztags && (
          <button type="button" onClick={() => setStundenwert(zeitwertVorschlag(beginn, ende, pauseMin))}>
            Vorschlag übernehmen
          </button>
        )}
        <label>
          Farbe
          <input type="color" value={farbe} onChange={(e) => setFarbe(e.target.value)} />
        </label>
        <label>
          Kategorie
          <select value={kategorie} onChange={(e) => setKategorie(e.target.value as "dienst" | "abwesenheit")}>
            <option value="dienst">Dienst (Tag, Nacht, ...)</option>
            <option value="abwesenheit">Abwesenheit (Krankheit, Urlaub, ...)</option>
          </select>
        </label>
        <button type="submit">Anlegen</button>
      </form>
      <p className="hint">
        Abwesenheitsschichten lassen sich wie normale Schichten in der Plantafel zuweisen, lösen aber keine
        Ruhezeit-Konfliktprüfung aus. Ein unbelegter Tag wird in den Übersichten automatisch als „Freischicht" angezeigt.
      </p>
      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Kürzel</th>
            <th>Bezeichnung</th>
            <th>Zeit</th>
            <th>Pause (Min.)</th>
            <th>Zeitwert (Std.)</th>
            <th>Farbe</th>
            <th>Kategorie</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {schichtarten.map((s) =>
            editId === s.id && editForm ? (
              <tr key={s.id}>
                <td>
                  <input value={editForm.kuerzel} maxLength={4} onChange={(e) => setEditForm({ ...editForm, kuerzel: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.bezeichnung} onChange={(e) => setEditForm({ ...editForm, bezeichnung: e.target.value })} />
                </td>
                <td>
                  <label className="inline-label">
                    <input
                      type="checkbox"
                      checked={editForm.ganztags}
                      onChange={(e) => setEditForm({ ...editForm, ganztags: e.target.checked })}
                    />
                    ganztägig
                  </label>
                  {!editForm.ganztags && (
                    <>
                      <input type="time" value={editForm.beginn} onChange={(e) => setEditForm({ ...editForm, beginn: e.target.value })} />
                      –
                      <input type="time" value={editForm.ende} onChange={(e) => setEditForm({ ...editForm, ende: e.target.value })} />
                    </>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    style={{ width: "4rem" }}
                    value={editForm.pause_min}
                    onChange={(e) => setEditForm({ ...editForm, pause_min: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={0.25}
                    min={0}
                    style={{ width: "4rem" }}
                    value={editForm.stundenwert ?? ""}
                    placeholder="keiner"
                    onChange={(e) =>
                      setEditForm({ ...editForm, stundenwert: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                  {!editForm.ganztags && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          stundenwert: zeitwertVorschlag(editForm.beginn, editForm.ende, editForm.pause_min),
                        })
                      }
                    >
                      Vorschlag
                    </button>
                  )}
                </td>
                <td>
                  <input type="color" value={editForm.farbe} onChange={(e) => setEditForm({ ...editForm, farbe: e.target.value })} />
                </td>
                <td>
                  <select
                    value={editForm.kategorie}
                    onChange={(e) => setEditForm({ ...editForm, kategorie: e.target.value as "dienst" | "abwesenheit" })}
                  >
                    <option value="dienst">Dienst</option>
                    <option value="abwesenheit">Abwesenheit</option>
                  </select>
                </td>
                <td>
                  <button onClick={bearbeitenSpeichern}>Speichern</button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(null);
                      setEditForm(null);
                    }}
                  >
                    Abbrechen
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={s.id}>
                <td>{s.kuerzel}</td>
                <td>{s.bezeichnung}</td>
                <td>{s.ganztags ? "ganztägig" : `${s.beginn}–${s.ende}`}</td>
                <td>{s.pause_min}</td>
                <td>{s.stundenwert ?? "–"}</td>
                <td>
                  <span className="badge" style={{ background: s.farbe }}>
                    &nbsp;
                  </span>
                </td>
                <td>{s.kategorie === "abwesenheit" ? "Abwesenheit" : "Dienst"}</td>
                <td>
                  <button onClick={() => bearbeitenStart(s)}>Bearbeiten</button>
                </td>
              </tr>
            )
          )}
          {schichtarten.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                Noch keine Schichtart angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function PlanungseinheitenSektion({ alleEinheiten, onGeaendert }: { alleEinheiten: Planungseinheit[]; onGeaendert: () => void }) {
  const [name, setName] = useState("");
  const [standort, setStandort] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/planungseinheiten", { method: "POST", body: JSON.stringify({ name, standort: standort || undefined }) });
      setName("");
      setStandort("");
      onGeaendert();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Planungseinheiten (Administration)</h2>
      <form className="card form-inline" onSubmit={anlegen}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="z. B. Pflegeteam Station 2" />
        </label>
        <label>
          Standort
          <input value={standort} onChange={(e) => setStandort(e.target.value)} />
        </label>
        <button type="submit">Anlegen</button>
      </form>
      {error && <div className="error">{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Standort</th>
          </tr>
        </thead>
        <tbody>
          {alleEinheiten.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.standort ?? "–"}</td>
            </tr>
          ))}
          {alleEinheiten.length === 0 && (
            <tr>
              <td colSpan={2} className="empty">
                Noch keine Planungseinheit angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// Feiertage eines Jahres: werden beim ersten Zugriff automatisch aus der gesetzlichen NRW-Regel
// generiert (siehe backend lib/feiertage.ts), sind danach bearbeitbar und um Sonderregelungen
// (zusaetzliche, manuell angelegte Eintraege) ergaenzbar. Grundlage der Jahresarbeitszeit-Berechnung.
function FeiertageSektion() {
  const [jahr, setJahr] = useState(new Date().getFullYear() + 1);
  const [feiertage, setFeiertage] = useState<FeiertagEintrag[]>([]);
  const [neuDatum, setNeuDatum] = useState("");
  const [neuBezeichnung, setNeuBezeichnung] = useState("");
  const [error, setError] = useState<string | null>(null);

  function laden() {
    api<FeiertagEintrag[]>(`/feiertage?jahr=${jahr}`).then(setFeiertage);
  }
  useEffect(laden, [jahr]);

  async function aendern(f: FeiertagEintrag, aenderung: Partial<Pick<FeiertagEintrag, "datum" | "bezeichnung" | "istFrei">>) {
    await api(`/feiertage/${f.id}`, {
      method: "PUT",
      body: JSON.stringify({ datum: f.datum, bezeichnung: f.bezeichnung, istFrei: f.istFrei, ...aenderung }),
    });
    laden();
  }

  async function entfernen(id: number) {
    await api(`/feiertage/${id}`, { method: "DELETE" });
    laden();
  }

  async function sonderregelungAnlegen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!neuDatum || !neuBezeichnung) return;
    try {
      await api("/feiertage", {
        method: "POST",
        body: JSON.stringify({ jahr, datum: neuDatum, bezeichnung: neuBezeichnung, istFrei: true }),
      });
      setNeuDatum("");
      setNeuBezeichnung("");
      laden();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>Feiertage</h2>
      <div className="inline-label">
        Jahr
        <input type="number" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={{ width: "5rem" }} />
        <span className="hint">Gesetzliche Feiertage NRW werden automatisch generiert und sind unten bearbeitbar.</span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Datum</th>
            <th>Bezeichnung</th>
            <th>Arbeitsfrei</th>
            <th>Herkunft</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {feiertage.map((f) => (
            <tr key={f.id}>
              <td>
                <input
                  type="date"
                  defaultValue={f.datum}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== f.datum) aendern(f, { datum: e.target.value });
                  }}
                />
              </td>
              <td>
                <input
                  defaultValue={f.bezeichnung}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== f.bezeichnung) aendern(f, { bezeichnung: e.target.value });
                  }}
                />
              </td>
              <td>
                <input type="checkbox" checked={f.istFrei} onChange={(e) => aendern(f, { istFrei: e.target.checked })} />
              </td>
              <td>
                <span className="badge-typ">{f.quelle === "generiert" ? "generiert" : "Sonderregelung"}</span>
              </td>
              <td>
                <button type="button" onClick={() => entfernen(f.id)} title={f.quelle === "generiert" ? "Als nicht arbeitsfrei markieren" : "Entfernen"}>
                  ×
                </button>
              </td>
            </tr>
          ))}
          {feiertage.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Keine Feiertage geladen.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="card form-inline" onSubmit={sonderregelungAnlegen}>
        <h3>Sonderregelung hinzufügen</h3>
        <label>
          Datum
          <input type="date" value={neuDatum} onChange={(e) => setNeuDatum(e.target.value)} required />
        </label>
        <label>
          Bezeichnung
          <input value={neuBezeichnung} onChange={(e) => setNeuBezeichnung(e.target.value)} required />
        </label>
        <button type="submit">Hinzufügen</button>
      </form>
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function BenutzerverwaltungSektion({ alleEinheiten }: { alleEinheiten: Planungseinheit[] }) {
  const [benutzer, setBenutzer] = useState<Benutzer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [personalnr, setPersonalnr] = useState("");
  const [sollStundenTaeglich, setSollStundenTaeglich] = useState<number | "">("");
  const [neuesPasswort, setNeuesPasswort] = useState<{ email: string; passwort: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [zuweisenBenutzerId, setZuweisenBenutzerId] = useState<number | null>(null);
  const [zuweisenPeId, setZuweisenPeId] = useState<number | null>(null);
  const [zuweisenRolle, setZuweisenRolle] = useState("mitarbeiter");

  const [jahr, setJahr] = useState(new Date().getFullYear() + 1);
  const [arbeitstage, setArbeitstage] = useState<Arbeitstage | null>(null);

  function laden() {
    api<Benutzer[]>("/benutzer").then(setBenutzer);
  }
  useEffect(laden, []);

  useEffect(() => {
    api<Arbeitstage>(`/arbeitstage?jahr=${jahr}`).then(setArbeitstage);
  }, [jahr]);

  async function sollStundenAendern(benutzerId: number, wert: number | "") {
    await api(`/benutzer/${benutzerId}`, { method: "PUT", body: JSON.stringify({ sollStundenTaeglich: wert === "" ? null : wert }) });
    laden();
  }

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ email: string; temporaeresPasswort: string }>("/benutzer", {
        method: "POST",
        body: JSON.stringify({ name, email, personalnr: personalnr || undefined, sollStundenTaeglich: sollStundenTaeglich || undefined }),
      });
      setNeuesPasswort({ email: res.email, passwort: res.temporaeresPasswort });
      setName("");
      setEmail("");
      setPersonalnr("");
      setSollStundenTaeglich("");
      laden();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rolleZuweisen(e: FormEvent) {
    e.preventDefault();
    if (!zuweisenBenutzerId || !zuweisenPeId) return;
    await api(`/planungseinheiten/${zuweisenPeId}/mitglieder`, {
      method: "POST",
      body: JSON.stringify({ benutzerId: zuweisenBenutzerId, rolle: zuweisenRolle }),
    });
    laden();
  }

  async function rolleEntfernen(planungseinheitId: number, mitgliedschaftId: number) {
    await api(`/planungseinheiten/${planungseinheitId}/mitglieder/${mitgliedschaftId}`, { method: "DELETE" });
    laden();
  }

  return (
    <section>
      <h2>Benutzerverwaltung (Administration)</h2>

      <form className="card form-inline" onSubmit={anlegen}>
        <h3>Neuer Benutzer</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          E-Mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Personalnummer
          <input value={personalnr} onChange={(e) => setPersonalnr(e.target.value)} />
        </label>
        <label>
          Soll-Std./Tag
          <input
            type="number"
            min={0}
            step={0.5}
            value={sollStundenTaeglich}
            onChange={(e) => setSollStundenTaeglich(e.target.value ? Number(e.target.value) : "")}
            placeholder="optional"
          />
        </label>
        <button type="submit">Anlegen</button>
      </form>
      {error && <div className="error">{error}</div>}
      {neuesPasswort && (
        <p className="hint">
          Konto für {neuesPasswort.email} angelegt. Temporäres Passwort (bitte weitergeben, wird nicht erneut angezeigt):{" "}
          <code>{neuesPasswort.passwort}</code>
        </p>
      )}

      <form className="card form-inline" onSubmit={rolleZuweisen}>
        <h3>Rolle zuweisen</h3>
        <label>
          Benutzer
          <select value={zuweisenBenutzerId ?? ""} onChange={(e) => setZuweisenBenutzerId(Number(e.target.value))}>
            <option value="">– auswählen –</option>
            {benutzer.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.email})
              </option>
            ))}
          </select>
        </label>
        <label>
          Planungseinheit
          <select value={zuweisenPeId ?? ""} onChange={(e) => setZuweisenPeId(Number(e.target.value))}>
            <option value="">– auswählen –</option>
            {alleEinheiten.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rolle
          <select value={zuweisenRolle} onChange={(e) => setZuweisenRolle(e.target.value)}>
            <option value="planer">Planer</option>
            <option value="mitarbeiter">Mitarbeiter</option>
            <option value="betrachter">Betrachter</option>
          </select>
        </label>
        <button type="submit" disabled={!zuweisenBenutzerId || !zuweisenPeId}>
          Zuweisen
        </button>
      </form>

      <div className="inline-label">
        Jahresarbeitszeit für
        <input type="number" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={{ width: "5rem" }} />
        {arbeitstage && (
          <span className="hint">
            {arbeitstage.arbeitstage} Arbeitstage ({arbeitstage.wochentageGesamt} Wochentage − {arbeitstage.feiertageAnWochentagen}{" "}
            Feiertage NRW an Wochentagen)
          </span>
        )}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>E-Mail</th>
            <th>Soll-Std./Tag</th>
            <th>Jahresarbeitszeit {jahr}</th>
            <th>Rollen</th>
          </tr>
        </thead>
        <tbody>
          {benutzer.map((b) => (
            <tr key={b.id}>
              <td>
                {b.name}
                {!!b.ist_admin && <span className="badge-typ"> Admin</span>}
              </td>
              <td>{b.email}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  defaultValue={b.soll_stunden_taeglich ?? ""}
                  placeholder="keine"
                  onBlur={(e) => {
                    const wert = e.target.value ? Number(e.target.value) : "";
                    if (wert !== (b.soll_stunden_taeglich ?? "")) sollStundenAendern(b.id, wert);
                  }}
                />
              </td>
              <td>
                {b.soll_stunden_taeglich != null && arbeitstage
                  ? `${(b.soll_stunden_taeglich * arbeitstage.arbeitstage).toLocaleString("de-DE", { maximumFractionDigits: 1 })} h`
                  : "–"}
              </td>
              <td>
                {b.mitgliedschaften.map((m) => (
                  <span key={m.id} className="rolle-chip">
                    {m.planungseinheit_name}: {m.rolle}{" "}
                    <button type="button" onClick={() => rolleEntfernen(m.planungseinheit_id, m.id)} title="Rolle entfernen">
                      ×
                    </button>
                  </span>
                ))}
                {b.mitgliedschaften.length === 0 && <span className="empty">keine</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const WOCHENTAGE_KURZ = ["Tag 1", "Tag 2", "Tag 3", "Tag 4", "Tag 5", "Tag 6", "Tag 7"];

// Wiederverwendbare Schichtblock-Vorlagen (z. B. "Wochenende Fruehschicht", "Nachtschicht 3er
// Block") fuer die direkte Top-down-Zuweisung in der Plantafel -- unabhaengig von der
// Schichtboerse/Jahresabfrage.
function SchichtblockVorlagenSektion({ peId }: { peId: number }) {
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([]);
  const [bezeichnung, setBezeichnung] = useState("");
  const [eintraege, setEintraege] = useState<{ tagOffset: number; schichtartId: number }[]>([{ tagOffset: 0, schichtartId: 0 }]);
  const [error, setError] = useState<string | null>(null);

  function laden() {
    api<Schichtart[]>(`/planungseinheiten/${peId}/schichtarten`).then((s) => {
      setSchichtarten(s);
      setEintraege((prev) => prev.map((e) => ({ ...e, schichtartId: e.schichtartId || s[0]?.id || 0 })));
    });
    api<Vorlage[]>(`/planungseinheiten/${peId}/schichtblock-vorlagen`).then(setVorlagen);
  }

  useEffect(laden, [peId]);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/planungseinheiten/${peId}/schichtblock-vorlagen`, {
        method: "POST",
        body: JSON.stringify({ bezeichnung, eintraege }),
      });
      setBezeichnung("");
      setEintraege([{ tagOffset: 0, schichtartId: schichtarten[0]?.id ?? 0 }]);
      laden();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loeschen(id: number) {
    await api(`/schichtblock-vorlagen/${id}`, { method: "DELETE" });
    laden();
  }

  if (schichtarten.length === 0) return null;

  return (
    <section>
      <h2>Schichtblock-Vorlagen</h2>
      <p className="hint">
        Wiederverwendbare Muster für die direkte Zuweisung ganzer Blöcke in der Plantafel, z. B. „Wochenende Frühschicht"
        (Tag 1+2 Frühschicht) oder „Nachtschicht 3er Block" (Tag 1–3 Nachtschicht).
      </p>
      <form className="card form-inline" onSubmit={anlegen}>
        <label>
          Bezeichnung
          <input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} required placeholder="z. B. Nachtschicht 3er Block" />
        </label>
        {eintraege.map((e, i) => (
          <div className="zeile" key={i}>
            <span className="hint">{WOCHENTAGE_KURZ[e.tagOffset] ?? `Tag ${e.tagOffset + 1}`}</span>
            <select
              value={e.schichtartId}
              onChange={(ev) => {
                const copy = [...eintraege];
                copy[i] = { ...copy[i], schichtartId: Number(ev.target.value) };
                setEintraege(copy);
              }}
            >
              {schichtarten.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kuerzel} – {s.bezeichnung}
                </option>
              ))}
            </select>
            {eintraege.length > 1 && (
              <button type="button" onClick={() => setEintraege(eintraege.filter((_, idx) => idx !== i))}>
                Entfernen
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setEintraege([...eintraege, { tagOffset: eintraege.length, schichtartId: schichtarten[0]?.id ?? 0 }])
          }
        >
          + Tag hinzufügen
        </button>
        <button type="submit">Vorlage anlegen</button>
        {error && <div className="error">{error}</div>}
      </form>

      <table className="table">
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>Enthält</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {vorlagen.map((v) => (
            <tr key={v.id}>
              <td>{v.bezeichnung}</td>
              <td>{v.eintraege.map((e) => `Tag ${e.tag_offset + 1}: ${e.kuerzel}`).join(", ")}</td>
              <td>
                <button onClick={() => loeschen(v.id)}>Löschen</button>
              </td>
            </tr>
          ))}
          {vorlagen.length === 0 && (
            <tr>
              <td colSpan={3} className="empty">
                Noch keine Vorlage angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
