import crypto from "crypto";
import { db } from "./db";
import { pruefeKonflikte } from "./regelwerk";

export interface VorschlagBlock {
  schichtblockId: number;
  bezeichnung: string;
  bedarf: number;
  vorgeschlagen: number[];
  begruendung: string[];
}

interface Bewerbungszeile {
  benutzer_id: number;
  name: string;
  antwort: string;
}

// Vergabevorschlag fuer eine ganze Jahresabfrage (Konzept Kap. 3.5): knappste Termine zuerst,
// je Termin "Ja" vor "Wenn noetig", danach Ausgleich ueber die Wunschanzahl und die
// Vorjahreshistorie, Gleichstand ueber einen reproduzierbaren, seed-basierten Tie-Break statt
// echtem Zufall. Liefert nur einen Entwurf -- geschrieben wird ausschliesslich ueber den
// bestehenden /schichtbloecke/:id/vergeben-Endpunkt.
export function berechneVergabevorschlag(ausschreibungId: number | string): { seed: string; bloecke: VorschlagBlock[] } {
  const ausschreibung = db.prepare("SELECT * FROM ausschreibung WHERE id = ?").get(ausschreibungId) as any;
  const seed = `jahresabfrage-${ausschreibungId}`;

  const bloecke = db
    .prepare("SELECT * FROM schichtblock WHERE ausschreibung_id = ? ORDER BY datum_sort, id")
    .all(ausschreibungId) as any[];

  const wunschAnzahl = new Map<number, number | null>();
  for (const t of db
    .prepare("SELECT benutzer_id, wunsch_anzahl FROM abfrage_teilnehmer WHERE ausschreibung_id = ?")
    .all(ausschreibungId) as any[]) {
    if (t.benutzer_id) wunschAnzahl.set(t.benutzer_id, t.wunsch_anzahl);
  }
  const vergebenDieseRunde = new Map<number, number>();

  function vorjahresVergaben(benutzerId: number): number {
    if (!ausschreibung.zeitraum_von) return 0;
    const row = db
      .prepare(
        `SELECT COUNT(*) c FROM vergabe_protokoll
         WHERE benutzer_id = ? AND entschieden_am >= date(?, '-1 year') AND entschieden_am < date(?)`
      )
      .get(benutzerId, ausschreibung.zeitraum_von, ausschreibung.zeitraum_von) as { c: number };
    return row.c;
  }

  function tieBreak(benutzerId: number, blockId: number): string {
    return crypto.createHash("sha256").update(`${seed}:${blockId}:${benutzerId}`).digest("hex");
  }

  const mitDaten = bloecke.map((block) => {
    const bewerbungen = db
      .prepare(
        `SELECT bw.benutzer_id, bw.antwort, be.name FROM bewerbung bw JOIN benutzer be ON be.id = bw.benutzer_id
         WHERE bw.schichtblock_id = ? AND bw.antwort IN ('ja','wenn_noetig')`
      )
      .all(block.id) as Bewerbungszeile[];
    const schichten = db.prepare("SELECT * FROM blockschicht WHERE schichtblock_id = ?").all(block.id) as {
      datum: string;
      schichtart_id: number | null;
    }[];
    const zusagen = bewerbungen.filter((b) => b.antwort === "ja").length;
    return { block, bewerbungen, schichten, verhaeltnis: block.personen_bedarf > 0 ? zusagen / block.personen_bedarf : 0 };
  });

  // Knappste Termine (wenigste Zusagen relativ zum Bedarf) zuerst
  mitDaten.sort((a, b) => a.verhaeltnis - b.verhaeltnis);

  const ergebnisNachBlockId = new Map<number, VorschlagBlock>();

  for (const { block, bewerbungen, schichten } of mitDaten) {
    const konfliktfrei = bewerbungen.filter((bw) =>
      schichten.every((s) => {
        // Bereitschaften loesen keine Doppelbelegungs-/Ruhezeit-Pruefung aus (keine Schicht).
        if (s.schichtart_id == null) return true;
        const konflikte = pruefeKonflikte(bw.benutzer_id, s.schichtart_id, s.datum);
        return !konflikte.some((k) => k.typ === "doppelbelegung" || k.typ === "ruhezeit");
      })
    );

    const kandidaten = konfliktfrei
      .filter((bw) => {
        const wunsch = wunschAnzahl.get(bw.benutzer_id);
        if (wunsch == null) return true;
        return (vergebenDieseRunde.get(bw.benutzer_id) ?? 0) < wunsch;
      })
      .sort((a, b) => {
        if (a.antwort !== b.antwort) return a.antwort === "ja" ? -1 : 1;
        const relA = (vergebenDieseRunde.get(a.benutzer_id) ?? 0) / (wunschAnzahl.get(a.benutzer_id) || 1);
        const relB = (vergebenDieseRunde.get(b.benutzer_id) ?? 0) / (wunschAnzahl.get(b.benutzer_id) || 1);
        if (relA !== relB) return relA - relB;
        const vorjahrA = vorjahresVergaben(a.benutzer_id);
        const vorjahrB = vorjahresVergaben(b.benutzer_id);
        if (vorjahrA !== vorjahrB) return vorjahrA - vorjahrB;
        return tieBreak(a.benutzer_id, block.id).localeCompare(tieBreak(b.benutzer_id, block.id));
      });

    const ausgewaehlt = kandidaten.slice(0, block.personen_bedarf);
    for (const k of ausgewaehlt) {
      vergebenDieseRunde.set(k.benutzer_id, (vergebenDieseRunde.get(k.benutzer_id) ?? 0) + 1);
    }

    ergebnisNachBlockId.set(block.id, {
      schichtblockId: block.id,
      bezeichnung: block.bezeichnung,
      bedarf: block.personen_bedarf,
      vorgeschlagen: ausgewaehlt.map((k) => k.benutzer_id),
      begruendung: ausgewaehlt.map(
        (k) => `${k.name}: ${k.antwort === "ja" ? "Ja" : "Wenn nötig"} · ${vorjahresVergaben(k.benutzer_id)}× im Vorjahreszeitraum`
      ),
    });
  }

  return { seed, bloecke: bloecke.map((b) => ergebnisNachBlockId.get(b.id)!) };
}
