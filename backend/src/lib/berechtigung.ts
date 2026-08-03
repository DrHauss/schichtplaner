import { Response } from "express";
import { db } from "./db";
import { AuthedRequest } from "../middleware/auth";

// Prueft und beantwortet bei Bedarf direkt (404/403); Rueckgabewert gibt an, ob weitergemacht werden darf.
export function requirePlanerFuerAusschreibung(req: AuthedRequest, res: Response, ausschreibungId: string): boolean {
  if (req.user!.istAdmin) return true;
  const ausschreibung = db.prepare("SELECT planungseinheit_id FROM ausschreibung WHERE id = ?").get(ausschreibungId) as
    | { planungseinheit_id: number }
    | undefined;
  if (!ausschreibung) {
    res.status(404).json({ error: "Ausschreibung nicht gefunden" });
    return false;
  }
  const istPlaner = db
    .prepare("SELECT 1 FROM mitgliedschaft WHERE benutzer_id = ? AND planungseinheit_id = ? AND rolle = 'planer'")
    .get(req.user!.sub, ausschreibung.planungseinheit_id);
  if (!istPlaner) {
    res.status(403).json({ error: "Keine Planer-Berechtigung fuer diese Planungseinheit" });
    return false;
  }
  return true;
}

export function istPlanerFuerPlanungseinheit(req: AuthedRequest, planungseinheitId: number): boolean {
  if (req.user!.istAdmin) return true;
  return !!db
    .prepare("SELECT 1 FROM mitgliedschaft WHERE benutzer_id = ? AND planungseinheit_id = ? AND rolle = 'planer'")
    .get(req.user!.sub, planungseinheitId);
}

// Fuer planungseinheiten-uebergreifende Stammdaten (z. B. Feiertage, Schichtarten): Planer-
// Berechtigung in irgendeiner Planungseinheit genuegt, da es keine sinnvolle Zuordnung zu genau
// einer Einheit gibt.
export function istIrgendeinPlaner(req: AuthedRequest): boolean {
  if (req.user!.istAdmin) return true;
  return !!db.prepare("SELECT 1 FROM mitgliedschaft WHERE benutzer_id = ? AND rolle = 'planer'").get(req.user!.sub);
}

// Da Schichtarten global sind, "gehoert" eine Zuweisung keiner bestimmten Planungseinheit mehr.
// Verwalten darf sie, wer Planer einer Einheit ist, in der auch der betroffene Mitarbeiter Mitglied
// ist -- ein geteiltes Team genuegt, auch wenn die Schicht urspruenglich ueber ein anderes Team des
// Mitarbeiters zugewiesen wurde.
export function istPlanerFuerMitarbeiter(req: AuthedRequest, benutzerId: number): boolean {
  if (req.user!.istAdmin) return true;
  return !!db
    .prepare(
      `SELECT 1 FROM mitgliedschaft m1 JOIN mitgliedschaft m2 ON m1.planungseinheit_id = m2.planungseinheit_id
       WHERE m1.benutzer_id = ? AND m1.rolle = 'planer' AND m2.benutzer_id = ?`
    )
    .get(req.user!.sub, benutzerId);
}
