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
  ist_admin: number;
  mitgliedschaften: Mitgliedschaft[];
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
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Schichtart | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (peId) api<Schichtart[]>(`/planungseinheiten/${peId}/schichtarten`).then(setSchichtarten);
  }

  useEffect(load, [peId]);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!peId) return;
    await api(`/planungseinheiten/${peId}/schichtarten`, {
      method: "POST",
      body: JSON.stringify({ kuerzel, bezeichnung, beginn, ende, farbe }),
    });
    setKuerzel("");
    setBezeichnung("");
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
          Beginn
          <input type="time" value={beginn} onChange={(e) => setBeginn(e.target.value)} />
        </label>
        <label>
          Ende
          <input type="time" value={ende} onChange={(e) => setEnde(e.target.value)} />
        </label>
        <label>
          Farbe
          <input type="color" value={farbe} onChange={(e) => setFarbe(e.target.value)} />
        </label>
        <button type="submit">Anlegen</button>
      </form>
      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Kürzel</th>
            <th>Bezeichnung</th>
            <th>Zeit</th>
            <th>Farbe</th>
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
                  <input type="time" value={editForm.beginn} onChange={(e) => setEditForm({ ...editForm, beginn: e.target.value })} />
                  –
                  <input type="time" value={editForm.ende} onChange={(e) => setEditForm({ ...editForm, ende: e.target.value })} />
                </td>
                <td>
                  <input type="color" value={editForm.farbe} onChange={(e) => setEditForm({ ...editForm, farbe: e.target.value })} />
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
                <td>
                  {s.beginn}–{s.ende}
                </td>
                <td>
                  <span className="badge" style={{ background: s.farbe }}>
                    &nbsp;
                  </span>
                </td>
                <td>
                  <button onClick={() => bearbeitenStart(s)}>Bearbeiten</button>
                </td>
              </tr>
            )
          )}
          {schichtarten.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
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

function BenutzerverwaltungSektion({ alleEinheiten }: { alleEinheiten: Planungseinheit[] }) {
  const [benutzer, setBenutzer] = useState<Benutzer[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [personalnr, setPersonalnr] = useState("");
  const [neuesPasswort, setNeuesPasswort] = useState<{ email: string; passwort: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [zuweisenBenutzerId, setZuweisenBenutzerId] = useState<number | null>(null);
  const [zuweisenPeId, setZuweisenPeId] = useState<number | null>(null);
  const [zuweisenRolle, setZuweisenRolle] = useState("mitarbeiter");

  function laden() {
    api<Benutzer[]>("/benutzer").then(setBenutzer);
  }
  useEffect(laden, []);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ email: string; temporaeresPasswort: string }>("/benutzer", {
        method: "POST",
        body: JSON.stringify({ name, email, personalnr: personalnr || undefined }),
      });
      setNeuesPasswort({ email: res.email, passwort: res.temporaeresPasswort });
      setName("");
      setEmail("");
      setPersonalnr("");
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

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>E-Mail</th>
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
