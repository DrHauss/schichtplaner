import express from "express";
import cors from "cors";
import "./lib/db";
import { authRouter } from "./routes/auth";
import { stammdatenRouter } from "./routes/stammdaten";
import { plantafelRouter } from "./routes/plantafel";
import { boerseRouter } from "./routes/boerse";
import { benachrichtigungenRouter } from "./routes/benachrichtigungen";
import { meinRouter } from "./routes/mein";
import { jahresabfrageRouter } from "./routes/jahresabfrage";
import { abfrageRouter } from "./routes/abfrage";
import { benutzerRouter } from "./routes/benutzer";
import { uebersichtRouter } from "./routes/uebersicht";
import { pruefeFristenUndErinnerungen } from "./lib/scheduler";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Reihenfolge wichtig: die generischen "/api"-Router unten pruefen requireAuth unconditional
// und antworten bei fehlendem Token direkt mit 401 (kein next()) -- daher muessen alle
// spezifischeren, teils unauthentifizierten Pfade (Login, Token-Zugang) vorher registriert werden.
app.use("/api/auth", authRouter);
app.use("/api/abfrage", abfrageRouter);
app.use("/api", stammdatenRouter);
app.use("/api", plantafelRouter);
app.use("/api", boerseRouter);
app.use("/api", jahresabfrageRouter);
app.use("/api/benutzer", benutzerRouter);
app.use("/api/uebersicht", uebersichtRouter);
app.use("/api/benachrichtigungen", benachrichtigungenRouter);
app.use("/api/mein", meinRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`SchichtWeb API laeuft auf http://localhost:${port}`);
});

// Frist-Automatik der Jahresabfrage (Konzept Kap. 3.4): stuendliche Pruefung, solange der
// Serverprozess laeuft.
pruefeFristenUndErinnerungen();
setInterval(pruefeFristenUndErinnerungen, 60 * 60 * 1000);
