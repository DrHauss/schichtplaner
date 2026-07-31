import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Layout() {
  const { user, mitgliedschaften, logout } = useAuth();
  const istPlaner = user?.istAdmin || mitgliedschaften.some((m) => m.rolle === "planer");

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">SchichtWeb</div>
        <nav>
          <NavLink to="/mein-plan">Mein Plan</NavLink>
          <NavLink to="/team-uebersicht">Team-Übersicht</NavLink>
          <NavLink to="/schichtboerse">Schichtbörse</NavLink>
          {istPlaner && <NavLink to="/plantafel">Plantafel</NavLink>}
          {istPlaner && <NavLink to="/stammdaten">Stammdaten</NavLink>}
        </nav>
        <div className="user-info">
          <span>{user?.name}</span>
          <button onClick={logout}>Abmelden</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
