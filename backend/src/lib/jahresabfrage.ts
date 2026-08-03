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
  schichten: { datum: string; kuerzel: string; beginn: string | null; ende: string | null }[];
}

export interface Vorgabe {
  quelle: "serie" | "gruppe";
  quelleId: number;
  bezeichnung: string;
  mindestZusagen: number;
  zusagenAnzahl: number;
  erfuellt: boolean;
}

export interface RasterZeile {
  teilnehmerId: number;
  benutzerId: number | null;
  name: string;
  wunschAnzahl: number | null;
  abgegebenAm: string | null;
  vorgaben: Vorgabe[];
  vollstaendig: boolean;
  versteckt: boolean;
  // Angebote (Schichtbloecke) ohne jegliche Antwort dieses Teilnehmers -- unabhaengig von den
  // Mindestanzahl-Vorgaben: hier muss ueberhaupt geantwortet werden (ja/wenn_noetig/nein), egal
  // ob eine Vorgabe konfiguriert ist.
  unbeantwortet: number[];
  zellen: Record<number, { antwort: string; gesperrt: boolean; grund?: string }>;
}

// Mindestanzahl gilt je Terminserie, nicht pauschal fuer die ganze Jahresabfrage -- z. B.
// "mind. 3 Wochenende Fruehschicht" und getrennt davon "mind. 2 Nachtschicht-4er-Bloecke".
// Innerhalb einer Serie kann die Mindestanzahl zusaetzlich je Teilnehmer individuell
// abweichen (terminserie_mindestzusagen, z. B. weniger Nachtschichten fuer Teilzeitkraefte);
// ohne individuellen Eintrag gilt der Standard der Serie. Eine Serie ohne Standard und ohne
// individuelle Vorgabe fuer diesen Teilnehmer erzeugt keine Vorgabe.
//
// Zusaetzlich koennen mehrere Serien zu einer Gruppe zusammengefasst werden (terminserie_gruppe),
// mit einer gemeinsamen Mindestanzahl ueber alle Zusagen der Gruppe hinweg -- z. B. "Wochenenddienste"
// aus den Serien Fruehschicht und Spaetschicht, mind. 3 insgesamt (z. B. 2x Frueh + 1x Spaet). Die
// Gruppen-Vorgabe gilt zusaetzlich zu, nicht statt, den Vorgaben der einzelnen Serien.
export function ladeVorgabenStatus(ausschreibungId: number | string, teilnehmerId: number, benutzerId: number): Vorgabe[] {
  const serien = db
    .prepare(
      `SELECT t.id, t.bezeichnung, t.mindest_zusagen as standard, tm.mindest_zusagen as override
       FROM terminserie t
       LEFT JOIN terminserie_mindestzusagen tm ON tm.terminserie_id = t.id AND tm.teilnehmer_id = ?
       WHERE t.ausschreibung_id = ? AND (t.mindest_zusagen IS NOT NULL OR tm.mindest_zusagen IS NOT NULL)`
    )
    .all(teilnehmerId, ausschreibungId) as { id: number; bezeichnung: string; standard: number | null; override: number | null }[];

  const serienVorgaben: Vorgabe[] = serien.map((s) => {
    const mindestZusagen = s.override ?? (s.standard as number);
    const zusagenAnzahl = (
      db
        .prepare(
          `SELECT COUNT(*) c FROM bewerbung bw JOIN schichtblock sb ON sb.id = bw.schichtblock_id
           WHERE bw.benutzer_id = ? AND bw.antwort = 'ja' AND sb.terminserie_id = ?`
        )
        .get(benutzerId, s.id) as { c: number }
    ).c;
    return {
      quelle: "serie",
      quelleId: s.id,
      bezeichnung: s.bezeichnung,
      mindestZusagen,
      zusagenAnzahl,
      erfuellt: zusagenAnzahl >= mindestZusagen,
    };
  });

  const gruppen = db
    .prepare(
      `SELECT g.id, g.bezeichnung, g.mindest_zusagen as standard, gm.mindest_zusagen as override
       FROM terminserie_gruppe g
       LEFT JOIN gruppe_mindestzusagen gm ON gm.gruppe_id = g.id AND gm.teilnehmer_id = ?
       WHERE g.ausschreibung_id = ? AND (g.mindest_zusagen IS NOT NULL OR gm.mindest_zusagen IS NOT NULL)`
    )
    .all(teilnehmerId, ausschreibungId) as { id: number; bezeichnung: string; standard: number | null; override: number | null }[];

  const gruppenVorgaben: Vorgabe[] = gruppen.map((g) => {
    const mindestZusagen = g.override ?? (g.standard as number);
    const zusagenAnzahl = (
      db
        .prepare(
          `SELECT COUNT(*) c FROM bewerbung bw JOIN schichtblock sb ON sb.id = bw.schichtblock_id
           WHERE bw.benutzer_id = ? AND bw.antwort = 'ja'
           AND sb.terminserie_id IN (SELECT terminserie_id FROM terminserie_gruppe_mitglied WHERE gruppe_id = ?)`
        )
        .get(benutzerId, g.id) as { c: number }
    ).c;
    return {
      quelle: "gruppe",
      quelleId: g.id,
      bezeichnung: g.bezeichnung,
      mindestZusagen,
      zusagenAnzahl,
      erfuellt: zusagenAnzahl >= mindestZusagen,
    };
  });

  return [...serienVorgaben, ...gruppenVorgaben];
}

// Ohne konfigurierte Vorgaben gilt die alte, einfache Regel: irgendeine Antwort genuegt.
// Sobald mind. eine Vorgabe existiert, muessen alle erfuellt sein.
export function istVollstaendig(vorgaben: Vorgabe[], abgegebenAm: string | null): boolean {
  if (vorgaben.length === 0) return !!abgegebenAm;
  return vorgaben.every((v) => v.erfuellt);
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
    // LEFT JOIN auf beide Tabellen, da ein Eintrag entweder eine Schicht ODER eine Bereitschaft
    // ist (siehe blockschicht in lib/db.ts).
    schichten: db
      .prepare(
        `SELECT bs.datum, COALESCE(sa.kuerzel, ba.kuerzel) as kuerzel, sa.beginn, sa.ende
         FROM blockschicht bs
         LEFT JOIN schichtart sa ON sa.id = bs.schichtart_id
         LEFT JOIN bereitschaftsart ba ON ba.id = bs.bereitschaftsart_id
         WHERE bs.schichtblock_id = ? ORDER BY bs.datum`
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
    const vorgaben = t.benutzer_id ? ladeVorgabenStatus(ausschreibungId, t.id, t.benutzer_id) : [];
    // Unabhaengig von der Sichtbarkeits-Einstellung (zeigeAlle/versteckt) ermittelt -- jeder
    // Teilnehmer muss fuer sich selbst wissen, welche Angebote noch offen sind.
    const unbeantwortet = t.benutzer_id
      ? bloecke
          .filter((b) => {
            const bw = db
              .prepare("SELECT antwort FROM bewerbung WHERE schichtblock_id = ? AND benutzer_id = ?")
              .get(b.id, t.benutzer_id) as { antwort: string } | undefined;
            return !bw?.antwort;
          })
          .map((b) => b.id)
      : [];
    return {
      teilnehmerId: t.id,
      benutzerId: t.benutzer_id,
      name: t.name,
      wunschAnzahl: t.wunsch_anzahl,
      abgegebenAm: t.abgegeben_am,
      vorgaben,
      vollstaendig: istVollstaendig(vorgaben, t.abgegeben_am),
      versteckt: !zeigeAlle && !istEigeneZeile,
      unbeantwortet,
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
          schichtart_id: number | null;
        }[];
        const konflikte: Konflikt[] = [];
        // Bereitschaften loesen keine Doppelbelegungs-/Ruhezeit-Pruefung aus (keine Schicht).
        for (const s of schichten) if (s.schichtart_id != null) konflikte.push(...pruefeKonflikte(benutzerId, s.schichtart_id, s.datum));
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
// planungseinheitId ist optional -- Ausschreibungen sind nicht mehr zwingend an ein Team gebunden
// (siehe ausschreibung_team); ohne (globale oder mehrteamige) Zuordnung wird keine neue
// Mitgliedschaft vergeben, da es kein eindeutiges "zustaendiges" Team gibt.
export function legeTeilnehmerAn(ausschreibungId: number | string, planungseinheitId: number | null, eintrag: TeilnehmerEintrag) {
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
  if (planungseinheitId != null) {
    db.prepare("INSERT OR IGNORE INTO mitgliedschaft (benutzer_id, planungseinheit_id, rolle) VALUES (?,?,'mitarbeiter')").run(
      benutzerId,
      planungseinheitId
    );
  }

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
