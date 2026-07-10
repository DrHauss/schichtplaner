import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("planer@schichtweb.de");
  const [passwort, setPasswort] = useState("planer123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/mein-plan" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, passwort);
      navigate("/mein-plan");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>SchichtWeb</h1>
        <p className="subtitle">Dienstplanung &amp; Schichtbörse</p>
        <label>
          E-Mail
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Passwort
          <input value={passwort} onChange={(e) => setPasswort(e.target.value)} type="password" required />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? "Anmelden…" : "Anmelden"}
        </button>
        <p className="hint">
          Demo-Zugänge: admin@schichtweb.de / admin123 · planer@schichtweb.de / planer123 · anna@schichtweb.de / test1234
        </p>
      </form>
    </div>
  );
}
