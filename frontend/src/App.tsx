import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import MeinPlanPage from "./pages/MeinPlanPage";
import SchichtboersePage from "./pages/SchichtboersePage";
import AusschreibungDetailPage from "./pages/AusschreibungDetailPage";
import PlantafelPage from "./pages/PlantafelPage";
import StammdatenPage from "./pages/StammdatenPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-info">Lade…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/mein-plan" replace />} />
        <Route path="mein-plan" element={<MeinPlanPage />} />
        <Route path="schichtboerse" element={<SchichtboersePage />} />
        <Route path="schichtboerse/ausschreibung/:id" element={<AusschreibungDetailPage />} />
        <Route path="plantafel" element={<PlantafelPage />} />
        <Route path="stammdaten" element={<StammdatenPage />} />
      </Route>
    </Routes>
  );
}
