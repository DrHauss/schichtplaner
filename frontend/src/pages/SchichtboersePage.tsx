import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDatumZeit } from "../lib/datum";

interface Team {
  id: number;
  name: string;
}

interface Ausschreibung {
  id: number;
  titel: string;
  bewerbungsfrist: string;
  vergabeverfahren: string;
  status: "entwurf" | "veroeffentlicht" | "geschlossen";
  erstellt_am: string;
  typ: "runde" | "jahresabfrage";
  teams: Team[];
}

// Team-Checkboxen fuer die Anlage-Formulare: leere Auswahl = Ausschreibung gilt global (alle
// Teams/alle Mitarbeiter), sonst 1 oder mehrere gezielt gewaehlte Teams -- Ausschreibungen sind
// nicht mehr zwingend an genau ein Team gebunden.
function TeamAuswahl({ teams, ausgewaehlt, onChange }: { teams: Team[]; ausgewaehlt: number[]; onChange: (ids: number[]) => void }) {
  return (
    <div className="wochentage-auswahl">
      {teams.map((t) => (
        <label key={t.id} className="wochentag-checkbox">
          <input
            type="checkbox"
            checked={ausgewaehlt.includes(t.id)}
            onChange={(e) => onChange(e.target.checked ? [...ausgewaehlt, t.id] : ausgewaehlt.filter((x) => x !== t.id))}
          />
          {t.name}
        </label>
      ))}
      {teams.length === 0 && <span className="empty">Keine eigenen Teams.</span>}
    </div>
  );
}

export default function SchichtboersePage() {
  const navigate = useNavigate();
  const { mitgliedschaften, user } = useAuth();

  // Administratoren duerfen laut Backend ueberall planen, haben aber oft keine Mitgliedschaft --
  // fuer sie werden alle Planungseinheiten als "eigene" Teams geladen (analog PlantafelPage).
  const [adminEinheiten, setAdminEinheiten] = useState<Team[]>([]);
  useEffect(() => {
    if (user?.istAdmin) api<Team[]>("/planungseinheiten").then(setAdminEinheiten);
  }, [user?.istAdmin]);

  const eigenePlanerTeams = useMemo<Team[]>(
    () =>
      user?.istAdmin
        ? adminEinheiten
        : mitgliedschaften.filter((m) => m.rolle === "planer").map((m) => ({ id: m.planungseinheit_id, name: m.planungseinheit_name })),
    [mitgliedschaften, adminEinheiten, user?.istAdmin]
  );
  const kannAnlegen = eigenePlanerTeams.length > 0;

  const [ausschreibungen, setAusschreibungen] = useState<Ausschreibung[]>([]);
  const [neuTitel, setNeuTitel] = useState("");
  const [neuFrist, setNeuFrist] = useState("");
  const [neuVerfahren, setNeuVerfahren] = useState("fairness");
  const [neuTeamIds, setNeuTeamIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jaTitel, setJaTitel] = useState("");
  const [jaVon, setJaVon] = useState("");
  const [jaBis, setJaBis] = useState("");
  const [jaFrist, setJaFrist] = useState("");
  const [jaTeamIds, setJaTeamIds] = useState<number[]>([]);
  const [jaBusy, setJaBusy] = useState(false);
  const [jaError, setJaError] = useState<string | null>(null);

  function load() {
    api<Ausschreibung[]>("/ausschreibungen").then(setAusschreibungen);
  }

  useEffect(load, []);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/ausschreibungen", {
        method: "POST",
        body: JSON.stringify({ titel: neuTitel, bewerbungsfrist: neuFrist, vergabeverfahren: neuVerfahren, planungseinheitIds: neuTeamIds }),
      });
      setNeuTitel("");
      setNeuFrist("");
      setNeuTeamIds([]);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function jahresabfrageAnlegen(e: FormEvent) {
    e.preventDefault();
    setJaBusy(true);
    setJaError(null);
    try {
      const res = await api<{ id: number }>("/jahresabfragen", {
        method: "POST",
        body: JSON.stringify({
          titel: jaTitel,
          zeitraumVon: jaVon,
          zeitraumBis: jaBis,
          bewerbungsfrist: jaFrist,
          planungseinheitIds: jaTeamIds,
        }),
      });
      setJaTitel("");
      setJaVon("");
      setJaBis("");
      setJaFrist("");
      setJaTeamIds([]);
      load();
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

      {kannAnlegen && (
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
          <label>Teams (keine Auswahl = gilt für alle Teams)</label>
          <TeamAuswahl teams={eigenePlanerTeams} ausgewaehlt={neuTeamIds} onChange={setNeuTeamIds} />
          <button type="submit" disabled={busy}>
            Anlegen
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      )}

      {kannAnlegen && (
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
          <label>Teams (keine Auswahl = gilt für alle Teams)</label>
          <TeamAuswahl teams={eigenePlanerTeams} ausgewaehlt={jaTeamIds} onChange={setJaTeamIds} />
          <button type="submit" disabled={jaBusy}>
            Anlegen
          </button>
          <p className="hint">
            Mindestanzahl Zusagen werden je Terminserie im Termingenerator der Abfrage festgelegt (z. B. getrennt für
            Wochenende Frühschicht und Nachtschicht-Blöcke).
          </p>
          {jaError && <div className="error">{jaError}</div>}
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Titel</th>
            <th>Team</th>
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
              <td>{a.teams.length > 0 ? a.teams.map((t) => t.name).join(", ") : "Alle Teams"}</td>
              <td>{formatDatumZeit(a.bewerbungsfrist)}</td>
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
              <td colSpan={6} className="empty">
                Keine Ausschreibungen vorhanden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
