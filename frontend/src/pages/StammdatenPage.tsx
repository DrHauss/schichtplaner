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

export default function StammdatenPage() {
  const { mitgliedschaften } = useAuth();
  const planerEinheiten = mitgliedschaften.filter((m) => m.rolle === "planer");
  const [peId, setPeId] = useState<number | null>(planerEinheiten[0]?.planungseinheit_id ?? null);
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [kuerzel, setKuerzel] = useState("");
  const [bezeichnung, setBezeichnung] = useState("");
  const [beginn, setBeginn] = useState("06:00");
  const [ende, setEnde] = useState("14:00");
  const [farbe, setFarbe] = useState("#3b82f6");

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

  if (planerEinheiten.length === 0) return <p className="empty">Keine Planer-Berechtigung.</p>;

  return (
    <div className="page">
      <h1>Stammdaten – Schichtarten</h1>
      {planerEinheiten.length > 1 && (
        <select value={peId ?? ""} onChange={(e) => setPeId(Number(e.target.value))}>
          {planerEinheiten.map((m) => (
            <option key={m.planungseinheit_id} value={m.planungseinheit_id}>
              {m.planungseinheit_name}
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

      <table className="table">
        <thead>
          <tr>
            <th>Kürzel</th>
            <th>Bezeichnung</th>
            <th>Zeit</th>
            <th>Farbe</th>
          </tr>
        </thead>
        <tbody>
          {schichtarten.map((s) => (
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
