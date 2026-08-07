import { Request, Response, NextFunction } from "express";
import { verifyToken, AppTokenPayload } from "../lib/auth";
import { db } from "../lib/db";

export interface AuthedRequest extends Request {
  user?: AppTokenPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Nicht angemeldet" });
  }
  try {
    req.user = verifyToken(header.slice("Bearer ".length));
  } catch {
    return res.status(401).json({ error: "Ungueltiges Token" });
  }
  // Deaktivierung/Loeschung wirkt sofort, auch bei einem noch gueltigen Token (bis zu 12h Laufzeit) --
  // ohne diese Pruefung koennte ein deaktiviertes Konto bis zum Token-Ablauf weiterarbeiten.
  const konto = db.prepare("SELECT aktiv FROM benutzer WHERE id = ?").get(req.user.sub) as { aktiv: number } | undefined;
  if (!konto || !konto.aktiv) {
    return res.status(401).json({ error: "Konto ist deaktiviert oder existiert nicht mehr" });
  }
  next();
}

// Prueft, ob der angemeldete Nutzer Planer (oder Admin) in der Planungseinheit ist
export function requirePlaner(planungseinheitIdParam = "planungseinheitId") {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Nicht angemeldet" });
    if (req.user.istAdmin) return next();
    const peId = Number(req.body?.[planungseinheitIdParam] ?? req.params?.[planungseinheitIdParam] ?? req.query?.[planungseinheitIdParam]);
    if (!peId) return res.status(400).json({ error: "planungseinheitId fehlt" });
    const row = db
      .prepare("SELECT 1 FROM mitgliedschaft WHERE benutzer_id = ? AND planungseinheit_id = ? AND rolle = 'planer'")
      .get(req.user.sub, peId);
    if (!row) return res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
    next();
  };
}
