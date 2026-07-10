import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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

export default function PlantafelPage() {
  const { mitgliedschaften } = useAuth();
  const planerEinheiten = mitgliedschaften.filter((m) => m.rolle === "planer");
  const [peId, setPeId] = useState<number | null>(planerEinheiten[0]?.planungseinheit_id ?? null);
  const [woche, setWoche] = useState(montagDieserWoche());
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter[]>([]);
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [zuweisungen, setZuweisungen] = useState<Zuweisung[]>([]);
  const [error, setError] = useState<string | null>(null);

  const tage = useMemo(() => wochenTage(woche), [woche]);

  function load() {
    if (!peId) return;
    api<{ mitarbeiter: Mitarbeiter[]; zuweisungen: Zuweisung[]; schichtarten: Schichtart[] }>(
      `/planungseinheiten/${peId}/plantafel?von=${tage[0]}&bis=${tage[6]}`
    ).then((d) => {
      setMitarbeiter(d.mitarbeiter);
      setZuweisungen(d.zuweisungen);
      setSchichtarten(d.schichtarten);
    });
  }

  useEffect(() => {
    load();
  }, [peId, woche]);

  function zelle(benutzerId: number, datum: string) {
    return zuweisungen.find((z) => z.benutzer_id === benutzerId && z.datum === datum);
  }

  async function zuweisen(benutzerId: number, datum: string) {
    if (schichtarten.length === 0) return;
    const kuerzelListe = schichtarten.map((s) => s.kuerzel).join("/");
    const kuerzel = prompt(`Schichtart (${kuerzelListe}) oder leer für "keine":`);
    if (!kuerzel) return;
    const sa = schichtarten.find((s) => s.kuerzel.toLowerCase() === kuerzel.toLowerCase());
    if (!sa) return alert("Unbekanntes Kürzel");
    setError(null);
    try {
      await api("/zuweisungen", {
        method: "POST",
        body: JSON.stringify({ benutzerId, schichtartId: sa.id, datum, planungseinheitId: peId }),
      });
      load();
    } catch (err) {
      const msg = (err as Error).message;
      if (confirm(`${msg}\nTrotzdem zuweisen?`)) {
        await api("/zuweisungen", {
          method: "POST",
          body: JSON.stringify({ benutzerId, schichtartId: sa.id, datum, planungseinheitId: peId, force: true }),
        });
        load();
      }
    }
  }

  async function loeschen(id: number) {
    await api(`/zuweisungen/${id}`, { method: "DELETE" });
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

  if (planerEinheiten.length === 0) return <p className="empty">Keine Planer-Berechtigung.</p>;

  return (
    <div className="page">
      <h1>Plantafel</h1>
      <div className="toolbar">
        {planerEinheiten.length > 1 && (
          <select value={peId ?? ""} onChange={(e) => setPeId(Number(e.target.value))}>
            {planerEinheiten.map((m) => (
              <option key={m.planungseinheit_id} value={m.planungseinheit_id}>
                {m.planungseinheit_name}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setWoche((w) => new Date(w.getTime() - 7 * 86400000))}>← Vorwoche</button>
        <span>
          {tage[0]} – {tage[6]}
        </span>
        <button onClick={() => setWoche((w) => new Date(w.getTime() + 7 * 86400000))}>Nächste Woche →</button>
        <button onClick={veroeffentlichen}>Plan veröffentlichen</button>
      </div>
      {error && <div className="error">{error}</div>}

      <table className="table plantafel">
        <thead>
          <tr>
            <th>Mitarbeiter</th>
            {tage.map((t) => (
              <th key={t}>{t.slice(5)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mitarbeiter.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              {tage.map((t) => {
                const z = zelle(m.id, t);
                const sa = z && schichtarten.find((s) => s.id === z.schichtart_id);
                return (
                  <td key={t} className="plan-zelle" onClick={() => !z && zuweisen(m.id, t)}>
                    {sa && (
                      <span
                        className="badge"
                        style={{ background: sa.farbe }}
                        title={`${sa.bezeichnung} (${z!.status})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Zuweisung löschen?")) loeschen(z!.id);
                        }}
                      >
                        {sa.kuerzel}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Legende: Zelle klicken zum Zuweisen, Badge klicken zum Löschen.</p>
    </div>
  );
}
