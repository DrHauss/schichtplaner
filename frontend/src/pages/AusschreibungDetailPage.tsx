import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDatum } from "../lib/datum";

interface Schicht {
  datum: string;
  kuerzel: string;
  bezeichnung: string;
  beginn: string;
  ende: string;
}

interface Bewerbung {
  id: number;
  status: string;
  prioritaet: number;
}

interface Block {
  id: number;
  bezeichnung: string;
  personen_bedarf: number;
  schichten: Schicht[];
  anzahlBewerbungen: number;
  anzahlVergeben: number;
  eigeneBewerbung: Bewerbung | null;
}

interface Schichtart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
}

interface VergabeBewerber {
  id: number;
  benutzer_id: number;
  name: string;
  prioritaet: number;
  vergabenLetzte90Tage: number;
}

export default function AusschreibungDetailPage() {
  const { id } = useParams();
  const { mitgliedschaften, user } = useAuth();
  const [bloecke, setBloecke] = useState<Block[]>([]);
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [peId, setPeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vergabeOffen, setVergabeOffen] = useState<number | null>(null);
  const [vergabeDaten, setVergabeDaten] = useState<VergabeBewerber[]>([]);
  const [fairnessVorschlag, setFairnessVorschlag] = useState<number[]>([]);

  const istPlanerHier = peId != null && (user?.istAdmin || mitgliedschaften.some((m) => m.rolle === "planer" && m.planungseinheit_id === peId));

  function load() {
    api<Block[]>(`/ausschreibungen/${id}/schichtbloecke`).then(setBloecke);
  }

  useEffect(() => {
    load();
    // Planungseinheit ermitteln über Mitgliedschaften (vereinfachte Annahme: erste Planer-Einheit)
    if (mitgliedschaften.length > 0) setPeId(mitgliedschaften[0].planungseinheit_id);
  }, [id]);

  useEffect(() => {
    api<Schichtart[]>("/schichtarten").then(setSchichtarten);
  }, []);

  async function veroeffentlichen() {
    await api(`/ausschreibungen/${id}/veroeffentlichen`, { method: "POST" });
    alert("Ausschreibung veröffentlicht.");
  }

  async function bewerben(blockId: number, prioritaet: number) {
    setError(null);
    try {
      const res = await api<{ warnungen: { meldung: string }[] }>(`/schichtbloecke/${blockId}/bewerbungen`, {
        method: "POST",
        body: JSON.stringify({ prioritaet }),
      });
      if (res.warnungen?.length) {
        alert("Bewerbung gespeichert, aber Hinweise: " + res.warnungen.map((w) => w.meldung).join("; "));
      }
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function zurueckziehen(blockId: number) {
    await api(`/schichtbloecke/${blockId}/bewerbungen/zurueckziehen`, { method: "POST" });
    load();
  }

  async function vergabeOeffnen(blockId: number) {
    const data = await api<{ bewerbungen: VergabeBewerber[]; fairnessVorschlag: number[] }>(
      `/schichtbloecke/${blockId}/vergabeuebersicht`
    );
    setVergabeDaten(data.bewerbungen);
    setFairnessVorschlag(data.fairnessVorschlag);
    setVergabeOffen(blockId);
  }

  async function vergeben(blockId: number, benutzerId: number) {
    await api(`/schichtbloecke/${blockId}/vergeben`, {
      method: "POST",
      body: JSON.stringify({ benutzerIds: [benutzerId] }),
    });
    setVergabeOffen(null);
    load();
  }

  return (
    <div className="page">
      <h1>Ausschreibung #{id}</h1>
      {istPlanerHier && (
        <div className="actions">
          <button onClick={veroeffentlichen}>Ausschreibung veröffentlichen</button>
          {peId && <NeuerBlock ausschreibungId={Number(id)} schichtarten={schichtarten} onCreated={load} />}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="block-grid">
        {bloecke.map((b) => (
          <div className="card block-card" key={b.id}>
            <h3>{b.bezeichnung}</h3>
            <ul className="schicht-list">
              {b.schichten.map((s, i) => (
                <li key={i}>
                  {formatDatum(s.datum)} · {s.kuerzel} ({s.beginn}–{s.ende})
                </li>
              ))}
            </ul>
            <p>
              Bedarf: {b.personen_bedarf} · Bewerbungen: {b.anzahlBewerbungen} · Vergeben: {b.anzahlVergeben}
            </p>

            {!istPlanerHier && (
              <div className="bewerbung-aktionen">
                {b.eigeneBewerbung && b.eigeneBewerbung.status !== "zurueckgezogen" ? (
                  <>
                    <span className={`status status-${b.eigeneBewerbung.status}`}>{b.eigeneBewerbung.status}</span>
                    {b.eigeneBewerbung.status === "offen" && (
                      <button onClick={() => zurueckziehen(b.id)}>Bewerbung zurückziehen</button>
                    )}
                  </>
                ) : (
                  <button onClick={() => bewerben(b.id, 1)}>Bewerben</button>
                )}
              </div>
            )}

            {istPlanerHier && (
              <div className="planer-aktionen">
                <button onClick={() => vergabeOeffnen(b.id)}>Vergabeübersicht</button>
                {vergabeOffen === b.id && (
                  <div className="vergabe-panel">
                    <h4>Bewerber (Fairness-Reihenfolge markiert)</h4>
                    <ul>
                      {vergabeDaten.map((v) => (
                        <li key={v.id}>
                          {v.name} · Prio {v.prioritaet} · {v.vergabenLetzte90Tage}× in 90 Tagen
                          {fairnessVorschlag[0] === v.benutzer_id && <strong> ← Fairness-Vorschlag</strong>}{" "}
                          <button onClick={() => vergeben(b.id, v.benutzer_id)}>Vergeben</button>
                        </li>
                      ))}
                      {vergabeDaten.length === 0 && <li className="empty">Keine offenen Bewerbungen.</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {bloecke.length === 0 && <p className="empty">Noch keine Schichtblöcke angelegt.</p>}
      </div>
    </div>
  );
}

function NeuerBlock({
  ausschreibungId,
  schichtarten,
  onCreated,
}: {
  ausschreibungId: number;
  schichtarten: Schichtart[];
  onCreated: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const [bezeichnung, setBezeichnung] = useState("");
  const [personenBedarf, setPersonenBedarf] = useState(1);
  const [zeilen, setZeilen] = useState<{ datum: string; schichtartId: number }[]>([
    { datum: "", schichtartId: schichtarten[0]?.id ?? 0 },
  ]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api(`/ausschreibungen/${ausschreibungId}/schichtbloecke`, {
      method: "POST",
      body: JSON.stringify({
        bezeichnung,
        personenBedarf,
        schichten: zeilen.filter((z) => z.datum && z.schichtartId),
      }),
    });
    setOffen(false);
    setBezeichnung("");
    setZeilen([{ datum: "", schichtartId: schichtarten[0]?.id ?? 0 }]);
    onCreated();
  }

  if (!offen) return <button onClick={() => setOffen(true)}>+ Schichtblock anlegen</button>;

  return (
    <form className="card form-inline" onSubmit={submit}>
      <label>
        Bezeichnung
        <input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} required placeholder="z. B. Wochenende Frühschicht" />
      </label>
      <label>
        Personen-Bedarf
        <input type="number" min={1} value={personenBedarf} onChange={(e) => setPersonenBedarf(Number(e.target.value))} />
      </label>
      {zeilen.map((z, i) => (
        <div className="zeile" key={i}>
          <input
            type="date"
            value={z.datum}
            onChange={(e) => {
              const copy = [...zeilen];
              copy[i] = { ...copy[i], datum: e.target.value };
              setZeilen(copy);
            }}
          />
          <select
            value={z.schichtartId}
            onChange={(e) => {
              const copy = [...zeilen];
              copy[i] = { ...copy[i], schichtartId: Number(e.target.value) };
              setZeilen(copy);
            }}
          >
            {schichtarten.map((s) => (
              <option key={s.id} value={s.id}>
                {s.kuerzel} – {s.bezeichnung}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={() => setZeilen([...zeilen, { datum: "", schichtartId: schichtarten[0]?.id ?? 0 }])}>
        + Schicht hinzufügen
      </button>
      <button type="submit">Block speichern</button>
      <button type="button" onClick={() => setOffen(false)}>
        Abbrechen
      </button>
    </form>
  );
}
