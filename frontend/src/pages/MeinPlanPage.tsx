import { useEffect, useState } from "react";
import { api } from "../api/client";
import { getToken } from "../api/client";

interface PlanEintrag {
  id: number;
  datum: string;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
  beginn: string;
  ende: string;
}

interface Benachrichtigung {
  id: number;
  typ: string;
  payload: string;
  gelesen_am: string | null;
  erstellt_am: string;
}

function heute(offsetTage = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetTage);
  return d.toISOString().slice(0, 10);
}

export default function MeinPlanPage() {
  const [plan, setPlan] = useState<PlanEintrag[]>([]);
  const [benachrichtigungen, setBenachrichtigungen] = useState<Benachrichtigung[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<PlanEintrag[]>(`/mein/plan?von=${heute(-7)}&bis=${heute(60)}`),
      api<Benachrichtigung[]>("/benachrichtigungen"),
    ])
      .then(([p, b]) => {
        setPlan(p);
        setBenachrichtigungen(b);
      })
      .finally(() => setLoading(false));
  }, []);

  const icsUrl = `/api/mein/plan.ics`;
  const token = getToken();

  if (loading) return <div className="center-info">Lade…</div>;

  return (
    <div className="page">
      <h1>Mein Plan</h1>
      <p>
        <a
          href={icsUrl}
          onClick={(e) => {
            e.preventDefault();
            fetch(icsUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "mein-plan.ics";
                a.click();
              });
          }}
        >
          iCal-Kalender exportieren
        </a>
      </p>

      <section>
        <h2>Anstehende veröffentlichte Schichten</h2>
        {plan.length === 0 && <p className="empty">Keine Schichten im Zeitraum.</p>}
        <table className="table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Schicht</th>
              <th>Zeit</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => (
              <tr key={p.id}>
                <td>{p.datum}</td>
                <td>
                  <span className="badge" style={{ background: p.farbe }}>
                    {p.kuerzel}
                  </span>{" "}
                  {p.bezeichnung}
                </td>
                <td>
                  {p.beginn}–{p.ende}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Benachrichtigungen</h2>
        {benachrichtigungen.length === 0 && <p className="empty">Keine Benachrichtigungen.</p>}
        <ul className="notif-list">
          {benachrichtigungen.map((n) => (
            <li key={n.id} className={n.gelesen_am ? "read" : "unread"}>
              <strong>{n.typ}</strong> — {n.payload} <span className="ts">{n.erstellt_am}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
