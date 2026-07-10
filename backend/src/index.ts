import express from "express";
import cors from "cors";
import "./lib/db";
import { authRouter } from "./routes/auth";
import { stammdatenRouter } from "./routes/stammdaten";
import { plantafelRouter } from "./routes/plantafel";
import { boerseRouter } from "./routes/boerse";
import { benachrichtigungenRouter } from "./routes/benachrichtigungen";
import { meinRouter } from "./routes/mein";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api", stammdatenRouter);
app.use("/api", plantafelRouter);
app.use("/api", boerseRouter);
app.use("/api/benachrichtigungen", benachrichtigungenRouter);
app.use("/api/mein", meinRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`SchichtWeb API laeuft auf http://localhost:${port}`);
});
