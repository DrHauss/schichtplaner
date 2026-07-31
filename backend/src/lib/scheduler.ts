import { db } from "./db";
import { erinnereAusstehende } from "./jahresabfrage";

// Frist-Automatik der Jahresabfrage (Konzept Kap. 3.4): schliesst abgelaufene Abfragen und
// erinnert 14 Tage sowie 48 Stunden vor Fristende automatisch an ausstehende Antworten.
// Laeuft nur, solange der Serverprozess aktiv ist -- fuer das MVP ausreichend, siehe README.
export function pruefeFristenUndErinnerungen() {
  const jetzt = Date.now();
  const offene = db
    .prepare("SELECT * FROM ausschreibung WHERE status = 'veroeffentlicht' AND typ = 'jahresabfrage'")
    .all() as any[];

  for (const a of offene) {
    const stundenBisFrist = (new Date(a.bewerbungsfrist).getTime() - jetzt) / 3_600_000;

    if (stundenBisFrist <= 0) {
      db.prepare("UPDATE ausschreibung SET status = 'geschlossen' WHERE id = ?").run(a.id);
      continue;
    }
    if (stundenBisFrist <= 14 * 24 && !a.erinnerung_14_versendet) {
      erinnereAusstehende(a.id);
      db.prepare("UPDATE ausschreibung SET erinnerung_14_versendet = 1 WHERE id = ?").run(a.id);
    }
    if (stundenBisFrist <= 48 && !a.erinnerung_48h_versendet) {
      erinnereAusstehende(a.id);
      db.prepare("UPDATE ausschreibung SET erinnerung_48h_versendet = 1 WHERE id = ?").run(a.id);
    }
  }
}
