import crypto from "crypto";
import { db } from "./db";
import { hashPassword } from "./auth";
import { pruefeKonflikte, Konflikt } from "./regelwerk";

const GUELTIGE_ANTWORTEN = ["ja", "wenn_noetig", "nein"];

export interface RasterSpalte {
  schichtblockId: number;
  bezeichnung: string;
  bedarf: number;
  datumSort: string | null;
  schichten: { datum: string; kuerzel: string; beginn: string; ende: string }[];
}

export interface RasterZeile {
  teilnehmerId: number;
  benutzerId: number | null;
  name: string;
  wunschAnzahl: number | null;
  abgegebenAm: string | null;
  zusagenAnzahl: number;
  vollstaendig: boolean;
  versteckt: boolean;
  zellen: Record<number, { antwort: string; gesperrt: boolean; grund?: string }>;
}

// Anzahl "Ja"-Antworten eines Teilnehmers in dieser Jahresabfrage. Solange sie unter der
// konfigurierten Mindestanzahl (ausschreibung.min_bloecke) liegt, gilt die Rueckmeldung als
// unvollstaendig -- unabhaengig davon, ob bereits (mit "Nein"/"Wenn noetig") geantwortet wurde.
export function zaehleZusagen(ausschreibungId: number | string, benutzerId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) c FROM bewerbung bw JOIN schichtblock sb ON sb.id = bw.schichtblock_id
       WHERE bw.benutzer_id = ? AND sb.ausschreibung_id = ? AND bw.antwort = 'ja'`
    )
    .get(benutzerId, ausschreibungId) as { c: number };
  return row.c;
}

export function istVollstaendig(zusagenAnzahl: number, minBloecke: number | null): boolean {
  return !minBloecke || zusagenAnzahl >= minBloecke;
}

// Baut die Rasteransicht (Konzept Kap. 3.2) fuer eine Jahresabfrage. requesterBenutzerId/istPlaner
// steuern die Sichtbarkeits-Einstellung der Ausschreibung: bei 'alle' sehen sich Teilnehmer
// gegenseitig, sonst sieht jeder nur die eigene Zeile (Planer immer alles).
export function baueRaster(
  ausschreibungId: number | string,
  opts: { requesterBenutzerId?: number | null; istPlaner: boolean }
) {
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(ausschreibungId) as any;
  if (!ausschreibung) return null;

  const bloecke = db
    .prepare("SELECT * FROM schichtblock WHERE ausschreibung_id = ? ORDER BY datum_sort, id")
    .all(ausschreibungId) as any[];

  const spalten: RasterSpalte[] = bloecke.map((b) => ({
    schichtblockId: b.id,
    bezeichnung: b.bezeichnung,
    bedarf: b.personen_bedarf,
    datumSort: b.datum_sort,
    schichten: db
      .prepare(
        `SELECT bs.datum, sa.kuerzel, sa.beginn, sa.ende FROM blockschicht bs
         JOIN schichtart sa ON sa.id = bs.schichtart_id WHERE bs.schichtblock_id = ? ORDER BY bs.datum`
      )
      .all(b.id) as any[],
  }));

  const teilnehmer = db
    .prepare("SELECT * FROM abfrage_teilnehmer WHERE ausschreibung_id = ? ORDER BY name")
    .all(ausschreibungId) as any[];

  const zeigeAlle = opts.istPlaner || ausschreibung.sichtbarkeit === "alle";

  const zeilen: RasterZeile[] = teilnehmer.map((t) => {
    const istEigeneZeile = opts.requesterBenutzerId != null && t.benutzer_id === opts.requesterBenutzerId;
    const zellen: RasterZeile["zellen"] = {};
    if (zeigeAlle || istEigeneZeile) {
      for (const b of bloecke) {
        let gesperrt = false;
        let grund: string | undefined;
        if (t.benutzer_id) {
          const daten = db.prepare("SELECT datum FROM blockschicht WHERE schichtblock_id = ?").all(b.id) as { datum: string }[];
          for (const { datum } of daten) {
            const abw = db
              .prepare("SELECT typ FROM abwesenheit WHERE benutzer_id = ? AND status = 'genehmigt' AND ? BETWEEN von AND bis")
              .get(t.benutzer_id, datum) as { typ: string } | undefined;
            if (abw) {
              gesperrt = true;
              grund = abw.typ;
              break;
            }
          }
        }
        const bw = t.benutzer_id
          ? (db.prepare("SELECT antwort FROM bewerbung WHERE schichtblock_id = ? AND benutzer_id = ?").get(b.id, t.benutzer_id) as
              | { antwort: string }
              | undefined)
          : undefined;
        zellen[b.id] = { antwort: bw?.antwort ?? "", gesperrt, grund };
      }
    }
    const zusagenAnzahl = t.benutzer_id ? zaehleZusagen(ausschreibungId, t.benutzer_id) : 0;
    return {
      teilnehmerId: t.id,
      benutzerId: t.benutzer_id,
      name: t.name,
      wunschAnzahl: t.wunsch_anzahl,
      abgegebenAm: t.abgegeben_am,
      zusagenAnzahl,
      vollstaendig: istVollstaendig(zusagenAnzahl, ausschreibung.min_bloecke),
      versteckt: !zeigeAlle && !istEigeneZeile,
      zellen,
    };
  });

  const summen: Record<number, { ja: number; wenn_noetig: number; nein: number }> = {};
  for (const b of bloecke) summen[b.id] = { ja: 0, wenn_noetig: 0, nein: 0 };
  for (const t of teilnehmer) {
    for (const b of bloecke) {
      const bw = t.benutzer_id
        ? (db.prepare("SELECT antwort FROM bewerbung WHERE schichtblock_id = ? AND benutzer_id = ?").get(b.id, t.benutzer_id) as
            | { antwort: string }
            | undefined)
        : undefined;
      if (bw?.antwort === "ja") summen[b.id].ja++;
      else if (bw?.antwort === "wenn_noetig") summen[b.id].wenn_noetig++;
      else if (bw?.antwort === "nein") summen[b.id].nein++;
    }
  }

  return { ausschreibung, spalten, zeilen, summen };
}

export function schreibeAntworten(
  ausschreibungId: number | string,
  benutzerId: number,
  antworten: { schichtblockId: number; antwort: string }[]
) {
  const warnungen: Record<number, Konflikt[]> = {};
  const tx = db.transaction(() => {
    for (const a of antworten) {
      if (!GUELTIGE_ANTWORTEN.includes(a.antwort)) continue;
      const block = db.prepare("SELECT * FROM schichtblock WHERE id = ? AND ausschreibung_id = ?").get(a.schichtblockId, ausschreibungId);
      if (!block) continue;

      db.prepare(
        `INSERT INTO bewerbung (schichtblock_id, benutzer_id, antwort, status, geaendert_am)
         VALUES (?,?,?,'offen', CURRENT_TIMESTAMP)
         ON CONFLICT(schichtblock_id, benutzer_id)
         DO UPDATE SET antwort = excluded.antwort, status = 'offen', geaendert_am = CURRENT_TIMESTAMP`
      ).run(a.schichtblockId, benutzerId, a.antwort);

      if (a.antwort !== "nein") {
        const schichten = db.prepare("SELECT * FROM blockschicht WHERE schichtblock_id = ?").all(a.schichtblockId) as {
          datum: string;
          schichtart_id: number;
        }[];
        const konflikte: Konflikt[] = [];
        for (const s of schichten) konflikte.push(...pruefeKonflikte(benutzerId, s.schichtart_id, s.datum));
        if (konflikte.length) warnungen[a.schichtblockId] = konflikte;
      }
    }
    db.prepare(
      "UPDATE abfrage_teilnehmer SET abgegeben_am = COALESCE(abgegeben_am, CURRENT_TIMESTAMP) WHERE ausschreibung_id = ? AND benutzer_id = ?"
    ).run(ausschreibungId, benutzerId);
  });
  tx();
  return { ok: true, warnungen };
}

export interface TeilnehmerEintrag {
  name: string;
  email?: string | null;
  wunschAnzahl?: number | null;
  benutzerId?: number | null;
}

// Legt einen Teilnehmer an oder aktualisiert dessen Wunschanzahl. Ohne bestehendes Benutzerkonto
// wird ein Konto ohne nutzbares Passwort erzeugt (kein Login noetig, aber alle bestehenden
// Mechanismen -- Plantafel, Vergabe, iCal -- funktionieren unveraendert weiter, Konzept Kap. 3.3).
export function legeTeilnehmerAn(ausschreibungId: number | string, planungseinheitId: number, eintrag: TeilnehmerEintrag) {
  let benutzerId = eintrag.benutzerId ?? null;
  if (!benutzerId && eintrag.email) {
    const bestehend = db.prepare("SELECT id FROM benutzer WHERE email = ?").get(eintrag.email) as { id: number } | undefined;
    benutzerId = bestehend?.id ?? null;
  }
  if (!benutzerId) {
    const email = eintrag.email || `teilnehmer-${crypto.randomBytes(4).toString("hex")}@platzhalter.schichtweb`;
    const info = db
      .prepare("INSERT INTO benutzer (email, passwort_hash, name) VALUES (?,?,?)")
      .run(email, hashPassword(crypto.randomBytes(16).toString("hex")), eintrag.name);
    benutzerId = Number(info.lastInsertRowid);
  }
  db.prepare("INSERT OR IGNORE INTO mitgliedschaft (benutzer_id, planungseinheit_id, rolle) VALUES (?,?,'mitarbeiter')").run(
    benutzerId,
    planungseinheitId
  );

  const neuesToken = crypto.randomBytes(16).toString("hex");
  const zeile = db
    .prepare(
      `INSERT INTO abfrage_teilnehmer (ausschreibung_id, benutzer_id, name, email, token, wunsch_anzahl)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(ausschreibung_id, name) DO UPDATE SET wunsch_anzahl = excluded.wunsch_anzahl
       RETURNING id, token`
    )
    .get(ausschreibungId, benutzerId, eintrag.name, eintrag.email ?? null, neuesToken, eintrag.wunschAnzahl ?? null) as {
    id: number;
    token: string;
  };

  return { id: zeile.id, name: eintrag.name, token: zeile.token, benutzerId };
}

export function erinnereAusstehende(ausschreibungId: number | string) {
  const ausstehend = db
    .prepare("SELECT * FROM abfrage_teilnehmer WHERE ausschreibung_id = ? AND abgegeben_am IS NULL")
    .all(ausschreibungId) as any[];
  for (const t of ausstehend) {
    db.prepare("UPDATE abfrage_teilnehmer SET erinnert_am = CURRENT_TIMESTAMP WHERE id = ?").run(t.id);
    if (t.benutzer_id) {
      db.prepare("INSERT INTO benachrichtigung (empfaenger_id, typ, payload) VALUES (?,?,?)").run(
        t.benutzer_id,
        "jahresabfrage_erinnerung",
        JSON.stringify({ ausschreibungId })
      );
    }
  }
  return ausstehend.length;
}
