import path from "path";
import { db } from "./db";

// Erstellt eine konsistente Kopie der Datenbank, waehrend die Anwendung parallel weiterlaeuft --
// VACUUM INTO laeuft in einer eigenen Transaktion und ist damit sicherer als ein reines Kopieren
// der Datei im WAL-Modus (die eigentliche .sqlite-Datei allein ist ohne die zugehoerige -wal-Datei
// nicht zwingend konsistent).
//
// Aufruf z. B.: docker compose exec backend node dist/lib/backup.js
const zeitstempel = new Date().toISOString().replace(/[:.]/g, "-");
const ziel = path.join(__dirname, "..", "..", "data", `backup-${zeitstempel}.sqlite`);

db.exec(`VACUUM INTO '${ziel.replace(/'/g, "''")}'`);
console.log(`Backup geschrieben nach ${ziel}`);
