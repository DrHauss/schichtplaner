import { Router } from "express";
import { db } from "../lib/db";
import { requireAuth, requirePlaner, AuthedRequest } from "../middleware/auth";
import { requirePlanerFuerAusschreibung, istPlanerFuerPlanungseinheit } from "../lib/berechtigung";
import { berechneTermine, gruppiere, schichtartFuerDatum, Regel, Ausnahme, Gruppierung } from "../lib/terminserie";
import { baueRaster, schreibeAntworten, legeTeilnehmerAn, erinnereAusstehende, ladeVorgabenStatus, istVollstaendig } from "../lib/jahresabfrage";
import { berechneVergabevorschlag } from "../lib/vergabevorschlag";
import { benachrichtige } from "../lib/notify";

export const jahresabfrageRouter = Router();
jahresabfrageRouter.use(requireAuth);

// --- Anlegen ---

jahresabfrageRouter.post("/planungseinheiten/:id/jahresabfragen", requirePlaner("id"), (req: AuthedRequest, res) => {
  const { titel, zeitraumVon, zeitraumBis, bewerbungsfrist, antwortModus, sichtbarkeit, zugang } = req.body ?? {};
  if (!titel || !zeitraumVon || !zeitraumBis || !bewerbungsfrist) {
    return res.status(400).json({ error: "titel, zeitraumVon, zeitraumBis, bewerbungsfrist erforderlich" });
  }
  const info = db
    .prepare(
      `INSERT INTO ausschreibung
         (titel, planungseinheit_id, bewerbungsfrist, vergabeverfahren, typ, zeitraum_von, zeitraum_bis, antwort_modus, sichtbarkeit, zugang)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      titel,
      req.params.id,
      bewerbungsfrist,
      "fairness",
      "jahresabfrage",
      zeitraumVon,
      zeitraumBis,
      antwortModus ?? "ja_wennnoetig_nein",
      sichtbarkeit ?? "alle",
      zugang ?? "link_persoenlich"
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

// --- Terminserien-Generator ---

jahresabfrageRouter.post("/ausschreibungen/:id/terminserien/vorschau", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { regel, ausnahmen, gruppierung, bezeichnung } = (req.body ?? {}) as {
    regel: Regel;
    ausnahmen?: Ausnahme[];
    gruppierung?: Gruppierung;
    bezeichnung?: string;
  };
  try {
    const termine = berechneTermine(regel, ausnahmen ?? []);
    const bloecke = gruppiere(termine, gruppierung ?? "pro_termin", bezeichnung ?? "Termin");
    res.json({ anzahlTermine: termine.length, anzahlBloecke: bloecke.length, bloecke });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

jahresabfrageRouter.get("/ausschreibungen/:id/terminserien", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const serien = db.prepare("SELECT * FROM terminserie WHERE ausschreibung_id = ? ORDER BY erstellt_am").all(req.params.id) as any[];
  const mitAnzahl = serien.map((s) => {
    const anzahl = db.prepare("SELECT COUNT(*) c FROM schichtblock WHERE terminserie_id = ?").get(s.id) as { c: number };
    return { ...s, anzahlBloecke: anzahl.c };
  });
  res.json(mitAnzahl);
});

jahresabfrageRouter.post("/ausschreibungen/:id/terminserien", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { bezeichnung, regel, ausnahmen, gruppierung, schichtartIds, personenBedarf, qualifikationId, mindestZusagen } = (req.body ??
    {}) as {
    bezeichnung: string;
    regel: Regel;
    ausnahmen?: Ausnahme[];
    gruppierung?: Gruppierung;
    schichtartIds: number[];
    personenBedarf?: number;
    qualifikationId?: number;
    mindestZusagen?: number;
  };
  if (!bezeichnung || !regel || !Array.isArray(schichtartIds) || schichtartIds.length === 0) {
    return res.status(400).json({ error: "bezeichnung, regel und schichtartIds[] erforderlich" });
  }

  let termine: string[];
  try {
    termine = berechneTermine(regel, ausnahmen ?? []);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  if (termine.length === 0) return res.status(400).json({ error: "Regel ergibt keine Termine" });

  const bloecke = gruppiere(termine, gruppierung ?? "pro_termin", bezeichnung);

  const insertSerie = db.prepare(
    `INSERT INTO terminserie (ausschreibung_id, bezeichnung, regel, schichtart_ids, personen_bedarf, qualifikation_id, ausnahmen, mindest_zusagen)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insertBlock = db.prepare(
    "INSERT INTO schichtblock (ausschreibung_id, bezeichnung, personen_bedarf, qualifikation_id, terminserie_id, datum_sort) VALUES (?,?,?,?,?,?)"
  );
  const insertSchicht = db.prepare("INSERT INTO blockschicht (schichtblock_id, datum, schichtart_id) VALUES (?,?,?)");

  const ergebnis = db.transaction(() => {
    const serieInfo = insertSerie.run(
      req.params.id,
      bezeichnung,
      JSON.stringify(regel),
      JSON.stringify(schichtartIds),
      personenBedarf ?? 1,
      qualifikationId ?? null,
      JSON.stringify(ausnahmen ?? []),
      mindestZusagen ?? null
    );
    const serieId = serieInfo.lastInsertRowid;
    for (const block of bloecke) {
      const blockInfo = insertBlock.run(req.params.id, block.bezeichnung, personenBedarf ?? 1, qualifikationId ?? null, serieId, block.termine[0]);
      for (const datum of block.termine) {
        insertSchicht.run(blockInfo.lastInsertRowid, datum, schichtartFuerDatum(datum, regel, schichtartIds));
      }
    }
    return serieId;
  })();

  res.status(201).json({ id: ergebnis, anzahlBloecke: bloecke.length, anzahlTermine: termine.length });
});

jahresabfrageRouter.put("/ausschreibungen/:id/terminserien/:sid", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const { mindestZusagen } = req.body ?? {};
  db.prepare("UPDATE terminserie SET mindest_zusagen = ? WHERE id = ? AND ausschreibung_id = ?").run(
    mindestZusagen === "" || mindestZusagen == null ? null : mindestZusagen,
    req.params.sid,
    req.params.id
  );
  res.json({ ok: true });
});

jahresabfrageRouter.delete("/ausschreibungen/:id/terminserien/:sid", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  db.prepare("DELETE FROM terminserie WHERE id = ? AND ausschreibung_id = ?").run(req.params.sid, req.params.id);
  res.json({ ok: true });
});

// --- Rasteransicht ---

jahresabfrageRouter.get("/ausschreibungen/:id/raster", (req: AuthedRequest, res) => {
  const ausschreibung = db.prepare("SELECT planungseinheit_id FROM ausschreibung WHERE id = ?").get(req.params.id) as
    | { planungseinheit_id: number }
    | undefined;
  if (!ausschreibung) return res.status(404).json({ error: "Nicht gefunden" });
  const istPlaner = istPlanerFuerPlanungseinheit(req, ausschreibung.planungseinheit_id);
  const raster = baueRaster(req.params.id, { requesterBenutzerId: req.user!.sub, istPlaner });
  res.json(raster);
});

jahresabfrageRouter.put("/ausschreibungen/:id/antworten", (req: AuthedRequest, res) => {
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(req.params.id) as any;
  if (!ausschreibung) return res.status(404).json({ error: "Nicht gefunden" });
  if (ausschreibung.status === "geschlossen") return res.status(409).json({ error: "Frist bereits abgelaufen" });
  const { antworten } = req.body ?? {};
  if (!Array.isArray(antworten)) return res.status(400).json({ error: "antworten[] erforderlich" });
  res.json(schreibeAntworten(req.params.id, req.user!.sub, antworten));
});

// --- Teilnehmerkreis, Einladung, Erinnerung, Fortschritt ---

jahresabfrageRouter.get("/ausschreibungen/:id/teilnehmer", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  res.json(db.prepare("SELECT * FROM abfrage_teilnehmer WHERE ausschreibung_id = ? ORDER BY name").all(req.params.id));
});

jahresabfrageRouter.post("/ausschreibungen/:id/teilnehmer", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(req.params.id) as any;
  const { teilnehmer, ausMitarbeitern } = req.body ?? {};

  const eintraege: { name: string; email?: string; wunschAnzahl?: number; benutzerId?: number }[] = [];
  if (ausMitarbeitern) {
    const mitarbeiter = db
      .prepare(
        `SELECT b.id, b.name, b.email FROM mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id
         WHERE m.planungseinheit_id = ? AND m.rolle = 'mitarbeiter'`
      )
      .all(ausschreibung.planungseinheit_id) as any[];
    for (const m of mitarbeiter) eintraege.push({ name: m.name, email: m.email, benutzerId: m.id });
  }
  if (Array.isArray(teilnehmer)) {
    for (const t of teilnehmer) if (t?.name) eintraege.push({ name: t.name, email: t.email, wunschAnzahl: t.wunschAnzahl });
  }
  if (eintraege.length === 0) return res.status(400).json({ error: "teilnehmer[] oder ausMitarbeitern erforderlich" });

  const angelegt = eintraege.map((e) => legeTeilnehmerAn(req.params.id, ausschreibung.planungseinheit_id, e));
  res.status(201).json({ anzahl: angelegt.length, teilnehmer: angelegt });
});

jahresabfrageRouter.post("/ausschreibungen/:id/einladen", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const teilnehmer = db
    .prepare("SELECT * FROM abfrage_teilnehmer WHERE ausschreibung_id = ? AND eingeladen_am IS NULL")
    .all(req.params.id) as any[];
  const links = teilnehmer.map((t) => {
    db.prepare("UPDATE abfrage_teilnehmer SET eingeladen_am = CURRENT_TIMESTAMP WHERE id = ?").run(t.id);
    if (t.benutzer_id) benachrichtige(t.benutzer_id, "jahresabfrage_einladung", { ausschreibungId: req.params.id, token: t.token });
    return { name: t.name, email: t.email, link: `/abfrage/${t.token}` };
  });
  res.json({ anzahl: links.length, links });
});

jahresabfrageRouter.post("/ausschreibungen/:id/erinnern", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  res.json({ anzahlErinnert: erinnereAusstehende(req.params.id) });
});

jahresabfrageRouter.get("/ausschreibungen/:id/fortschritt", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const teilnehmer = db
    .prepare("SELECT id, name, benutzer_id, abgegeben_am FROM abfrage_teilnehmer WHERE ausschreibung_id = ?")
    .all(req.params.id) as any[];
  const mitStatus = teilnehmer.map((t) => {
    const vorgaben = t.benutzer_id ? ladeVorgabenStatus(req.params.id, t.benutzer_id) : [];
    return {
      id: t.id,
      name: t.name,
      vorgaben: vorgaben.filter((v) => !v.erfuellt),
      vollstaendig: istVollstaendig(vorgaben, t.abgegeben_am),
    };
  });
  const ausstehend = mitStatus.filter((t) => !t.vollstaendig);

  const bloecke = db.prepare("SELECT * FROM schichtblock WHERE ausschreibung_id = ?").all(req.params.id) as any[];
  const engpaesse = bloecke
    .map((b) => {
      const ja = (db.prepare("SELECT COUNT(*) c FROM bewerbung WHERE schichtblock_id = ? AND antwort = 'ja'").get(b.id) as { c: number }).c;
      const wennNoetig = (
        db.prepare("SELECT COUNT(*) c FROM bewerbung WHERE schichtblock_id = ? AND antwort = 'wenn_noetig'").get(b.id) as { c: number }
      ).c;
      const ampel = ja >= b.personen_bedarf ? "ok" : ja + wennNoetig >= b.personen_bedarf ? "knapp" : "eng";
      return { schichtblockId: b.id, bezeichnung: b.bezeichnung, bedarf: b.personen_bedarf, ja, wennNoetig, ampel };
    })
    .filter((e) => e.ampel !== "ok");

  res.json({
    gesamt: teilnehmer.length,
    abgegeben: mitStatus.length - ausstehend.length,
    ausstehend,
    engpaesse,
  });
});

// --- Vergabevorschlag ---

jahresabfrageRouter.post("/ausschreibungen/:id/vergabevorschlag", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  res.json(berechneVergabevorschlag(req.params.id));
});

// --- Export ---

jahresabfrageRouter.get("/ausschreibungen/:id/export.csv", (req: AuthedRequest, res) => {
  if (!requirePlanerFuerAusschreibung(req, res, req.params.id)) return;
  const raster = baueRaster(req.params.id, { requesterBenutzerId: null, istPlaner: true });
  if (!raster) return res.status(404).json({ error: "Nicht gefunden" });
  const header = ["Name", ...raster.spalten.map((s) => s.bezeichnung)].join(";");
  const zeilen = raster.zeilen.map((z) => [z.name, ...raster.spalten.map((s) => z.zellen[s.schichtblockId]?.antwort ?? "")].join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="jahresabfrage-${req.params.id}.csv"`);
  res.send([header, ...zeilen].join("\r\n"));
});
