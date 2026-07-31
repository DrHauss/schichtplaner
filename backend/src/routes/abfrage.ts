import { Router, Request, Response, NextFunction } from "express";
import { db } from "../lib/db";
import { baueRaster, schreibeAntworten } from "../lib/jahresabfrage";

// Zugang per persoenlichem Link ohne Login (Konzept Kap. 3.3): eigener, unauthentifizierter
// Router mit striktem Rate-Limit, der ausschliesslich die eigene Zeile eines Teilnehmers lesen
// und beschreiben kann -- kein requireAuth, kein JWT.
export const abfrageRouter = Router();

const anfragenJeToken = new Map<string, number[]>();
const FENSTER_MS = 60_000;
const MAX_ANFRAGEN = 30;

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const schluessel = req.params.token;
  const jetzt = Date.now();
  const bisher = (anfragenJeToken.get(schluessel) ?? []).filter((t) => jetzt - t < FENSTER_MS);
  bisher.push(jetzt);
  anfragenJeToken.set(schluessel, bisher);
  if (bisher.length > MAX_ANFRAGEN) {
    return res.status(429).json({ error: "Zu viele Anfragen, bitte kurz warten" });
  }
  next();
}

abfrageRouter.use("/:token", rateLimit);

abfrageRouter.get("/:token", (req, res) => {
  const teilnehmer = db.prepare("SELECT * FROM abfrage_teilnehmer WHERE token = ?").get(req.params.token) as any;
  if (!teilnehmer) return res.status(404).json({ error: "Link ungueltig oder abgelaufen" });
  const raster = baueRaster(teilnehmer.ausschreibung_id, { requesterBenutzerId: teilnehmer.benutzer_id, istPlaner: false });
  if (!raster) return res.status(404).json({ error: "Abfrage nicht gefunden" });
  res.json({
    teilnehmer: {
      benutzerId: teilnehmer.benutzer_id,
      name: teilnehmer.name,
      wunschAnzahl: teilnehmer.wunsch_anzahl,
      abgegebenAm: teilnehmer.abgegeben_am,
    },
    ...raster,
  });
});

abfrageRouter.put("/:token/antworten", (req, res) => {
  const teilnehmer = db.prepare("SELECT * FROM abfrage_teilnehmer WHERE token = ?").get(req.params.token) as any;
  if (!teilnehmer) return res.status(404).json({ error: "Link ungueltig oder abgelaufen" });
  const ausschreibung = db.prepare("SELECT status FROM ausschreibung WHERE id = ?").get(teilnehmer.ausschreibung_id) as
    | { status: string }
    | undefined;
  if (!ausschreibung || ausschreibung.status === "geschlossen") {
    return res.status(409).json({ error: "Frist bereits abgelaufen" });
  }
  const { antworten } = req.body ?? {};
  if (!Array.isArray(antworten)) return res.status(400).json({ error: "antworten[] erforderlich" });
  res.json(schreibeAntworten(teilnehmer.ausschreibung_id, teilnehmer.benutzer_id, antworten));
});
