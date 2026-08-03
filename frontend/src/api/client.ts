const TOKEN_KEY = "schichtweb_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface Konflikt {
  typ: string;
  meldung: string;
  datum?: string; // nur bei Schichtblock-Zuweisungen gesetzt (Konflikt je Tag)
}

// Fehler mit vollstaendigem Antwort-Body: Ein einfacher Error wuerde nur die Meldung tragen,
// wodurch z. B. die Konfliktliste einer 409-Antwort nie in der Oberflaeche ankaeme.
// Bleibt abwaertskompatibel, da bestehende Aufrufer weiterhin nur .message lesen.
export class ApiError extends Error {
  status: number;
  details?: { konflikte?: Konflikt[] } & Record<string, unknown>;

  constructor(message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText;
    let details: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      details = body;
      message = body.error || JSON.stringify(body);
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
