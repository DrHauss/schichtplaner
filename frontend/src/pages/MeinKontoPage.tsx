import { FormEvent, useState } from "react";
import { api } from "../api/client";

export default function MeinKontoPage() {
  const [aktuellesPasswort, setAktuellesPasswort] = useState("");
  const [neuesPasswort, setNeuesPasswort] = useState("");
  const [neuesPasswortWiederholt, setNeuesPasswortWiederholt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErfolg(false);
    if (neuesPasswort !== neuesPasswortWiederholt) {
      setError("Neues Passwort und Wiederholung stimmen nicht überein");
      return;
    }
    setBusy(true);
    try {
      await api("/mein/passwort", { method: "PUT", body: JSON.stringify({ aktuellesPasswort, neuesPasswort }) });
      setErfolg(true);
      setAktuellesPasswort("");
      setNeuesPasswort("");
      setNeuesPasswortWiederholt("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Mein Konto</h1>

      <form className="card form-inline" onSubmit={onSubmit}>
        <h3>Passwort ändern</h3>
        <label>
          Aktuelles Passwort
          <input
            type="password"
            value={aktuellesPasswort}
            onChange={(e) => setAktuellesPasswort(e.target.value)}
            required
          />
        </label>
        <label>
          Neues Passwort
          <input
            type="password"
            value={neuesPasswort}
            onChange={(e) => setNeuesPasswort(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Neues Passwort wiederholen
          <input
            type="password"
            value={neuesPasswortWiederholt}
            onChange={(e) => setNeuesPasswortWiederholt(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Ändern…" : "Passwort ändern"}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      {erfolg && <p className="hint">Passwort erfolgreich geändert.</p>}
    </div>
  );
}
