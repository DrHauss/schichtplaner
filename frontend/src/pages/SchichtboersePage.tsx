import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Ausschreibung {
  id: number;
  titel: string;
  bewerbungsfrist: string;
  vergabeverfahren: string;
  status: "entwurf" | "veroeffentlicht" | "geschlossen";
  erstellt_am: string;
  typ: "runde" | "jahresabfrage";
}

export default function SchichtboersePage() {
  const navigate = useNavigate();
  const { mitgliedschaften, user } = useAuth();
  const planerEinheiten = mitgliedschaften.filter((m) => m.rolle === "planer" || user?.istAdmin);
  const alleEinheiten = mitgliedschaften;
  const [peId, setPeId] = useState<number | null>(alleEinheiten[0]?.planungseinheit_id ?? null);
  const [ausschreibungen, setAusschreibungen] = useState<Ausschreibung[]>([]);
  const [neuTitel, setNeuTitel] = useState("");
  const [neuFrist, setNeuFrist] = useState("");
  const [neuVerfahren, setNeuVerfahren] = useState("fairness");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jaTitel, setJaTitel] = useState("");
  const [jaVon, setJaVon] = useState("");
  const [jaBis, setJaBis] = useState("");
  const [jaFrist, setJaFrist] = useState("");
  const [jaBusy, setJaBusy] = useState(false);
  const [jaError, setJaError] = useState<string | null>(null);

  const istPlanerHier = planerEinheiten.some((m) => m.planungseinheit_id === peId);

  function load(pe: number) {
    api<Ausschreibung[]>(`/planungseinheiten/${pe}/ausschreibungen`).then(setAusschreibungen);
  }

  useEffect(() => {
    if (peId) load(peId);
  }, [peId]);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!peId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/planungseinheiten/${peId}/ausschreibungen`, {
        method: "POST",
        body: JSON.stringify({ titel: neuTitel, bewerbungsfrist: neuFrist, vergabeverfahren: neuVerfahren }),
      });
      setNeuTitel("");
      setNeuFrist("");
      load(peId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function jahresabfrageAnlegen(e: FormEvent) {
    e.preventDefault();
    if (!peId) return;
    setJaBusy(true);
    setJaError(null);
    try {
      const res = await api<{ id: number }>(`/planungseinheiten/${peId}/jahresabfragen`, {
        method: "POST",
        body: JSON.stringify({ titel: jaTitel, zeitraumVon: jaVon, zeitraumBis: jaBis, bewerbungsfrist: jaFrist }),
      });
      setJaTitel("");
      setJaVon("");
      setJaBis("");
      setJaFrist("");
      load(peId);
      navigate(`/schichtboerse/jahresabfrage/${res.id}`);
    } catch (err) {
      setJaError((err as Error).message);
    } finally {
      setJaBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Schichtbörse</h1>

      {alleEinheiten.length > 1 && (
        <label className="inline-label">
          Planungseinheit
          <select value={peId ?? ""} onChange={(e) => setPeId(Number(e.target.value))}>
            {alleEinheiten.map((m) => (
              <option key={m.planungseinheit_id} value={m.planungseinheit_id}>
                {m.planungseinheit_name}
              </option>
            ))}
          </select>
        </label>
      )}

      {istPlanerHier && (
        <form className="card form-inline" onSubmit={anlegen}>
          <h2>Neue Ausschreibungsrunde</h2>
          <label>
            Titel
            <input value={neuTitel} onChange={(e) => setNeuTitel(e.target.value)} required placeholder="z. B. Wochenenddienste August 2026" />
          </label>
          <label>
            Bewerbungsfrist
            <input type="date" value={neuFrist} onChange={(e) => setNeuFrist(e.target.value)} required />
          </label>
          <label>
            Vergabeverfahren
            <select value={neuVerfahren} onChange={(e) => setNeuVerfahren(e.target.value)}>
              <option value="manuell">Manuell</option>
              <option value="fairness">Fairness-Vorschlag</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>
            Anlegen
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      )}

      {istPlanerHier && (
        <form className="card form-inline" onSubmit={jahresabfrageAnlegen}>
          <h2>Neue Jahresabfrage</h2>
          <label>
            Titel
            <input value={jaTitel} onChange={(e) => setJaTitel(e.target.value)} required placeholder="z. B. Wochenenddienste 2027" />
          </label>
          <label>
            Zeitraum von
            <input type="date" value={jaVon} onChange={(e) => setJaVon(e.target.value)} required />
          </label>
          <label>
            Zeitraum bis
            <input type="date" value={jaBis} onChange={(e) => setJaBis(e.target.value)} required />
          </label>
          <label>
            Bewerbungsfrist
            <input type="datetime-local" value={jaFrist} onChange={(e) => setJaFrist(e.target.value)} required />
          </label>
          <button type="submit" disabled={jaBusy}>
            Anlegen
          </button>
          {jaError && <div className="error">{jaError}</div>}
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Titel</th>
            <th>Bewerbungsfrist</th>
            <th>Verfahren</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ausschreibungen.map((a) => (
            <tr key={a.id}>
              <td>
                {a.titel}
                {a.typ === "jahresabfrage" && <span className="badge-typ"> Jahresabfrage</span>}
              </td>
              <td>{a.bewerbungsfrist}</td>
              <td>{a.vergabeverfahren}</td>
              <td>
                <span className={`status status-${a.status}`}>{a.status}</span>
              </td>
              <td>
                <Link to={a.typ === "jahresabfrage" ? `/schichtboerse/jahresabfrage/${a.id}` : `/schichtboerse/ausschreibung/${a.id}`}>
                  Öffnen
                </Link>
              </td>
            </tr>
          ))}
          {ausschreibungen.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Keine Ausschreibungen vorhanden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
