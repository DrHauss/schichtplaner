import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { api, getToken, setToken } from "../api/client";

export interface Mitgliedschaft {
  id: number;
  rolle: "planer" | "mitarbeiter" | "betrachter";
  planungseinheit_id: number;
  planungseinheit_name: string;
}

export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  istAdmin: boolean;
}

interface AuthState {
  user: CurrentUser | null;
  mitgliedschaften: Mitgliedschaft[];
  login: (email: string, passwort: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [mitgliedschaften, setMitgliedschaften] = useState<Mitgliedschaft[]>([]);
  const [loading, setLoading] = useState(true);

  const restore = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const stored = localStorage.getItem("schichtweb_user");
      const storedM = localStorage.getItem("schichtweb_mitgliedschaften");
      if (stored) setUser(JSON.parse(stored));
      if (storedM) setMitgliedschaften(JSON.parse(storedM));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restore();
  }, [restore]);

  const login = useCallback(async (email: string, passwort: string) => {
    const data = await api<{ token: string; user: CurrentUser; mitgliedschaften: Mitgliedschaft[] }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, passwort }),
    });
    setToken(data.token);
    localStorage.setItem("schichtweb_user", JSON.stringify(data.user));
    localStorage.setItem("schichtweb_mitgliedschaften", JSON.stringify(data.mitgliedschaften ?? []));
    setUser(data.user);
    setMitgliedschaften(data.mitgliedschaften ?? []);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem("schichtweb_user");
    localStorage.removeItem("schichtweb_mitgliedschaften");
    setUser(null);
    setMitgliedschaften([]);
  }, []);

  const value = useMemo(
    () => ({ user, mitgliedschaften, login, logout, loading }),
    [user, mitgliedschaften, login, logout, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden");
  return ctx;
}
