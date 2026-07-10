import { db } from "./db";

// MVP: In-App-Benachrichtigungen (E-Mail-Versand als Ausbaustufe, hier nur Persistenz)
export function benachrichtige(empfaengerId: number, typ: string, payload: Record<string, unknown>) {
  db.prepare("INSERT INTO benachrichtigung (empfaenger_id, typ, payload) VALUES (?,?,?)").run(
    empfaengerId,
    typ,
    JSON.stringify(payload)
  );
}
