import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, Konflikt } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDatum, formatDatumZeit } from "../lib/datum";
import { kontrastfarbe } from "../lib/farbe";

interface Mitarbeiter {
  id: number;
  name: string;
}
interface Schichtart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
  kategorie: "dienst" | "abwesenheit";
  archiviert: boolean | number;
}
interface Zuweisung {
  id: number;
  benutzer_id: number;
  schichtart_id: number;
  datum: string;
  status: string;
}
interface VorlageEintrag {
  tag_offset: number;
  schichtart_id: number;
  kuerzel: string;
}
interface Vorlage {
  id: number;
  bezeichnung: string;
  eintraege: VorlageEintrag[];
  enthaeltArchivierte: boolean | number;
}
interface Kommentar {
  id: number;
  zuweisung_id: number;
  autor_name: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstellt_am: string;
}
interface FreischichtKommentar {
  id: number;
  benutzer_id: number;
  datum: string;
  autor_name: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstellt_am: string;
}
interface Planungseinheit {
  id: number;
  name: string;
}
// Bereitschaften sind keine Schichten oder Abwesenheiten -- eigene, orthogonale Zuweisung, die
// zusaetzlich zu (nicht statt) einer normalen Schicht am selben Tag bestehen kann.
interface Bereitschaftsart {
  id: number;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
  archiviert: boolean | number;
}
interface Bereitschaft {
  id: number;
  benutzer_id: number;
  bereitschaftsart_id: number;
  datum: string;
  status: string;
}
interface PlantafelDaten {
  mitarbeiter: Mitarbeiter[];
  zuweisungen: Zuweisung[];
  schichtarten: Schichtart[];
  kommentare: Kommentar[];
  freischichtKommentare: FreischichtKommentar[];
  bereitschaften: Bereitschaft[];
  bereitschaftsarten: Bereitschaftsart[];
}

// Werkzeug der Palette: einmal auswaehlen, dann Zellen anklicken (Stempel-Prinzip).
type Werkzeug =
  | { art: "schichtart"; schichtart: Schichtart }
  | { art: "bereitschaft"; bereitschaftsart: Bereitschaftsart }
  | { art: "vorlage"; peId: number; vorlage: Vorlage }
  | { art: "radierer" };

const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Schichtarten werden grundsaetzlich alphabetisch sortiert und in Dienst/Abwesenheit gruppiert
// dargestellt -- localeCompare("de") statt SQLite-Sortierung wegen deutscher Umlaute.
function nachDienstUndAbwesenheitGruppiert<
  T extends { kategorie: string; bezeichnung: string; archiviert?: boolean | number }
>(liste: T[]) {
  // Archivierte Schichtarten wandern innerhalb ihrer Gruppe immer ans Ende, unabhaengig vom Alphabet.
  const sortiert = (arr: T[]) =>
    [...arr].sort((a, b) => {
      const archivDiff = Number(!!a.archiviert) - Number(!!b.archiviert);
      if (archivDiff !== 0) return archivDiff;
      return a.bezeichnung.localeCompare(b.bezeichnung, "de");
    });
  return {
    dienst: sortiert(liste.filter((s) => s.kategorie !== "abwesenheit")),
    abwesenheit: sortiert(liste.filter((s) => s.kategorie === "abwesenheit")),
  };
}

function heuteJahrMonat() {
  const d = new Date();
  return { jahr: d.getFullYear(), monat: d.getMonth() + 1 };
}

function tageDesMonats(jahr: number, monat: number): string[] {
  const letzterTag = new Date(jahr, monat, 0).getDate();
  return Array.from({ length: letzterTag }, (_, i) => {
    const tag = i + 1;
    return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
  });
}

function wochentagKurz(datumIso: string): string {
  const d = new Date(`${datumIso}T00:00:00`);
  return WOCHENTAGE_KURZ[(d.getDay() + 6) % 7];
}

function istWochenende(datumIso: string): boolean {
  const tag = new Date(`${datumIso}T00:00:00`).getDay();
  return tag === 0 || tag === 6;
}

// Konfliktliste einer 409-Antwort lesbar aufbereiten; bei Schichtbloecken ist je Konflikt ein
// Datum dabei, bei Einzelzuweisungen nicht.
function konfliktText(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const konflikte = (err.details?.konflikte ?? []) as Konflikt[];
  if (konflikte.length === 0) return err.message;
  return konflikte.map((k) => (k.datum ? `${formatDatum(k.datum)}: ${k.meldung}` : k.meldung)).join("\n");
}

// Die Plantafel zeigt -- wie die Team-Uebersicht -- eine Monatsansicht mit allen eigenen Teams
// gleichzeitig, statt einer Woche eines einzeln ausgewaehlten Teams. Jedes Team bekommt eine
// eigene Sektion mit eigenem Monatsraster; Werkzeugleiste und Monatsnavigation sind gemeinsam.
export default function PlantafelPage() {
  const { user, mitgliedschaften } = useAuth();
  const planerEinheiten = mitgliedschaften.filter((m) => m.rolle === "planer");
  const istAdmin = !!user?.istAdmin;

  // Administratoren duerfen laut Backend ueberall planen, haben aber oft keine Mitgliedschaft --
  // fuer sie werden alle Planungseinheiten geladen.
  const [adminEinheiten, setAdminEinheiten] = useState<Planungseinheit[]>([]);
  useEffect(() => {
    if (istAdmin) api<Planungseinheit[]>("/planungseinheiten").then(setAdminEinheiten);
  }, [istAdmin]);

  const einheiten = useMemo(
    () =>
      planerEinheiten.length > 0
        ? planerEinheiten.map((m) => ({ id: m.planungseinheit_id, name: m.planungseinheit_name }))
        : adminEinheiten,
    [mitgliedschaften, adminEinheiten]
  );

  const [{ jahr, monat }, setMonat] = useState(heuteJahrMonat());
  const tage = useMemo(() => tageDesMonats(jahr, monat), [jahr, monat]);

  const [datenNachPe, setDatenNachPe] = useState<Map<number, PlantafelDaten>>(new Map());
  const [vorlagenNachPe, setVorlagenNachPe] = useState<Map<number, Vorlage[]>>(new Map());
  const [schichtarten, setSchichtarten] = useState<Schichtart[]>([]);
  const [bereitschaftsarten, setBereitschaftsarten] = useState<Bereitschaftsart[]>([]);
  const [feiertage, setFeiertage] = useState<Set<string>>(new Set());
  const [werkzeug, setWerkzeug] = useState<Werkzeug | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [freischichtDetail, setFreischichtDetail] = useState<{ peId: number; benutzerId: number; datum: string } | null>(null);
  // Radierer auf einer oder mehreren markierten Zellen: enthaelt die Markierung mehr als eine
  // Schicht-/Bereitschaftsart, wird statt sofort alles zu loeschen erst gefragt, welche Art(en)
  // entfernt werden sollen -- der Dialog zeigt alle in der Markierung vorkommenden Arten
  // gesammelt an (nicht Zelle fuer Zelle). Enthaelt die Markierung nur eine einzige Art (auch
  // ueber mehrere Zellen/Tage hinweg) oder nur einen einzigen Eintrag, wird direkt geloescht, da
  // dort nichts mehrdeutig ist.
  const [radiererAuswahl, setRadiererAuswahl] = useState<{ peId: number; benutzerId: number; datum: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ziehen: nach Auswahl von Schichtart oder Radierer koennen mehrere Zellen in einem Zug
  // erfasst werden (Maus gedrueckt halten, ueber Zellen fahren, loslassen). Die erfassten Zellen
  // liegen in einer Ref (kein Re-Render pro Eintrag), ein Tick-Zaehler stoesst die Neuzeichnung
  // fuer die Ziehen-Markierung an. Der Schluessel enthaelt die peId, da derselbe Mitarbeiter am
  // selben Tag in mehreren Team-Sektionen auftauchen kann.
  const dragZellenRef = useRef<Map<string, { peId: number; benutzerId: number; datum: string }>>(new Map());
  const [dragAktiv, setDragAktiv] = useState(false);
  const [, setDragTick] = useState(0);
  // Ziehen ist bewusst auf die Start-Zeile (Team+Mitarbeiter) beschraenkt -- zusaetzliche Zeilen
  // beim Ziehen zu erfassen waere selten beabsichtigt und schwer wieder rueckgaengig zu machen.
  // dragLetzterIndexRef merkt sich den zuletzt erfassten Tages-Index innerhalb der Zeile, damit
  // beim schnellen Ziehen uebersprungene Zellen (der Browser feuert mouseenter nicht fuer jede
  // Zelle, wenn die Maus schneller bewegt wird als der Cursor "wandert") nachtraeglich aufgefuellt
  // werden koennen, statt Luecken in der Auswahl zu lassen.
  const dragZeileRef = useRef<{ peId: number; benutzerId: number } | null>(null);
  const dragLetzterIndexRef = useRef<number | null>(null);

  async function load() {
    if (einheiten.length === 0) return;
    const von = tage[0];
    const bis = tage[tage.length - 1];
    const ergebnisse = await Promise.all(
      einheiten.map((pe) => api<PlantafelDaten>(`/planungseinheiten/${pe.id}/plantafel?von=${von}&bis=${bis}`))
    );
    const neueDaten = new Map<number, PlantafelDaten>();
    einheiten.forEach((pe, i) => neueDaten.set(pe.id, ergebnisse[i]));
    setDatenNachPe(neueDaten);
    if (ergebnisse[0]) {
      setSchichtarten(ergebnisse[0].schichtarten);
      setBereitschaftsarten(ergebnisse[0].bereitschaftsarten);
    }

    const vorlagenErgebnisse = await Promise.all(
      einheiten.map((pe) => api<Vorlage[]>(`/planungseinheiten/${pe.id}/schichtblock-vorlagen`))
    );
    const neueVorlagen = new Map<number, Vorlage[]>();
    einheiten.forEach((pe, i) => neueVorlagen.set(pe.id, vorlagenErgebnisse[i]));
    setVorlagenNachPe(neueVorlagen);
  }

  useEffect(() => {
    load();
    setDetailId(null);
    setFreischichtDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [einheiten.map((e) => e.id).join(","), jahr, monat]);

  useEffect(() => {
    api<{ datum: string; istFrei: boolean }[]>(`/feiertage?jahr=${jahr}`).then((f) =>
      setFeiertage(new Set(f.filter((x) => x.istFrei).map((x) => x.datum)))
    );
  }, [jahr]);

  function monatWechseln(delta: number) {
    setMonat(({ jahr, monat }) => {
      const d = new Date(jahr, monat - 1 + delta, 1);
      return { jahr: d.getFullYear(), monat: d.getMonth() + 1 };
    });
  }

  function zellenZuweisungen(peId: number, benutzerId: number, datum: string) {
    const daten = datenNachPe.get(peId);
    if (!daten) return [];
    return daten.zuweisungen.filter((z) => z.benutzer_id === benutzerId && z.datum === datum);
  }

  function zellenBereitschaften(peId: number, benutzerId: number, datum: string) {
    const daten = datenNachPe.get(peId);
    if (!daten) return [];
    return daten.bereitschaften.filter((b) => b.benutzer_id === benutzerId && b.datum === datum);
  }

  function kommentareFuer(peId: number, zuweisungId: number) {
    return (datenNachPe.get(peId)?.kommentare ?? []).filter((k) => k.zuweisung_id === zuweisungId);
  }

  function freischichtKommentareFuer(peId: number, benutzerId: number, datum: string) {
    return (datenNachPe.get(peId)?.freischichtKommentare ?? []).filter((k) => k.benutzer_id === benutzerId && k.datum === datum);
  }

  // Ein POST, bei Konflikten (409) Rueckfrage mit den konkreten Meldungen und Wiederholung mit force.
  async function postMitKonfliktabfrage(pfad: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(pfad, { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      const text = konfliktText(err);
      if (text === null) {
        setError((err as Error).message);
        return;
      }
      if (!confirm(`Konflikte:\n${text}\n\nTrotzdem zuweisen?`)) return;
      await api(pfad, { method: "POST", body: JSON.stringify({ ...body, force: true }) });
    }
    load();
  }

  async function zelleKlick(peId: number, benutzerId: number, datum: string) {
    if (!werkzeug || busy) return;
    setBusy(true);
    try {
      if (werkzeug.art === "schichtart") {
        await postMitKonfliktabfrage("/zuweisungen", {
          benutzerId,
          schichtartId: werkzeug.schichtart.id,
          datum,
          planungseinheitId: peId,
        });
      } else if (werkzeug.art === "bereitschaft") {
        await postMitKonfliktabfrage("/bereitschaften", {
          benutzerId,
          bereitschaftsartId: werkzeug.bereitschaftsart.id,
          datum,
          planungseinheitId: peId,
        });
      } else if (werkzeug.art === "vorlage") {
        await postMitKonfliktabfrage(`/schichtblock-vorlagen/${werkzeug.vorlage.id}/zuweisen`, {
          benutzerId,
          startDatum: datum,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  // Mehrere per Ziehen erfasste Zellen in einem Zug zuweisen. Konflikte einzelner Zellen werden
  // gesammelt und in einer einzigen Rueckfrage gebuendelt (statt einem Dialog je Zelle).
  async function batchZuweisen(zellen: { peId: number; benutzerId: number; datum: string }[], schichtartId: number) {
    setBusy(true);
    setError(null);
    const konflikte: { peId: number; benutzerId: number; datum: string; text: string }[] = [];
    for (const z of zellen) {
      try {
        await api("/zuweisungen", {
          method: "POST",
          body: JSON.stringify({ benutzerId: z.benutzerId, schichtartId, datum: z.datum, planungseinheitId: z.peId }),
        });
      } catch (err) {
        const text = konfliktText(err);
        if (text === null) {
          setError((err as Error).message);
          setBusy(false);
          load();
          return;
        }
        konflikte.push({ ...z, text });
      }
    }
    if (konflikte.length > 0) {
      const liste = konflikte
        .map((k) => `${datenNachPe.get(k.peId)?.mitarbeiter.find((m) => m.id === k.benutzerId)?.name ?? ""} ${formatDatum(k.datum)}: ${k.text}`)
        .join("\n");
      if (confirm(`Konflikte bei ${konflikte.length} Zelle(n):\n${liste}\n\nTrotzdem zuweisen?`)) {
        for (const k of konflikte) {
          await api("/zuweisungen", {
            method: "POST",
            body: JSON.stringify({ benutzerId: k.benutzerId, schichtartId, datum: k.datum, planungseinheitId: k.peId, force: true }),
          });
        }
      }
    }
    setBusy(false);
    load();
  }

  // Bereitschaften stapeln sich auf Zellen, ohne eine bestehende Konfliktpruefung auszuloesen --
  // daher ein einfacher Batch-POST ohne Konflikt-Rueckfrage (anders als batchZuweisen).
  async function batchBereitschaftenZuweisen(zellen: { peId: number; benutzerId: number; datum: string }[], bereitschaftsartId: number) {
    setBusy(true);
    setError(null);
    for (const z of zellen) {
      try {
        await api("/bereitschaften", {
          method: "POST",
          body: JSON.stringify({ benutzerId: z.benutzerId, bereitschaftsartId, datum: z.datum, planungseinheitId: z.peId }),
        });
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setBusy(false);
    load();
  }

  // Der Radierer leert eine Zelle vollstaendig -- sowohl zugewiesene Schichten als auch
  // Bereitschaften, die an derselben Zelle "kleben".
  async function batchLoeschen(zellen: { peId: number; benutzerId: number; datum: string }[]) {
    setBusy(true);
    const zuweisungIds = zellen.flatMap((z) => zellenZuweisungen(z.peId, z.benutzerId, z.datum).map((zw) => ({ id: zw.id, peId: z.peId })));
    for (const { id, peId } of zuweisungIds) {
      // kommentareBehalten=1: der Radierer loescht nur die Schicht, vorhandene Kommentare bleiben
      // als Freischicht-Kommentar der jeweiligen Team-Sektion erhalten (der Tag wird ja zur Freischicht).
      await api(`/zuweisungen/${id}?kommentareBehalten=1&planungseinheitId=${peId}`, { method: "DELETE" });
    }
    const bereitschaftIds = zellen.flatMap((z) => zellenBereitschaften(z.peId, z.benutzerId, z.datum).map((b) => b.id));
    for (const id of bereitschaftIds) {
      await api(`/bereitschaften/${id}`, { method: "DELETE" });
    }
    setBusy(false);
    load();
  }

  // Alle Zuweisungen/Bereitschaften der markierten Zellen gesammelt (mit peId je Eintrag, da
  // eine Loeschung die jeweils richtige Planungseinheit fuer kommentareBehalten braucht).
  function gesammelteZuweisungen(zellen: { peId: number; benutzerId: number; datum: string }[]) {
    return zellen.flatMap((z) => zellenZuweisungen(z.peId, z.benutzerId, z.datum).map((zw) => ({ ...zw, peId: z.peId })));
  }
  function gesammelteBereitschaften(zellen: { peId: number; benutzerId: number; datum: string }[]) {
    return zellen.flatMap((z) => zellenBereitschaften(z.peId, z.benutzerId, z.datum));
  }

  // Radierer auf einer oder mehreren markierten Zellen (Einzelklick oder Ziehen): kommen darin
  // mehrere Schicht-/Bereitschaftsarten vor, wird gefragt, welche Art(en) geloescht werden sollen
  // (gesammelt ueber die gesamte Markierung, nicht Zelle fuer Zelle). Kommt nur eine einzige Art
  // vor (auch mit mehreren Eintraegen derselben Art) oder nur ein einzelner Eintrag insgesamt,
  // ist "alles loeschen" eindeutig und der Dialog entfaellt.
  function radiererAusloesen(zellen: { peId: number; benutzerId: number; datum: string }[]) {
    const zuweisungen = gesammelteZuweisungen(zellen);
    const bereitschaften = gesammelteBereitschaften(zellen);
    const anzahlTypen = new Set(zuweisungen.map((z) => z.schichtart_id)).size + new Set(bereitschaften.map((b) => b.bereitschaftsart_id)).size;
    if (zuweisungen.length + bereitschaften.length <= 1 || anzahlTypen <= 1) {
      batchLoeschen(zellen);
      return;
    }
    setRadiererAuswahl(zellen);
  }

  // Loescht eine bestimmte Schicht-/Bereitschaftsart aus der gesamten Markierung (kann mehrere
  // Zellen/Tage betreffen). Der Dialog bleibt offen, bis die Markierung leer ist (siehe Effekt
  // unten), damit nacheinander mehrere Arten entfernt werden koennen.
  async function radiererTypLoeschen(art: "zuweisung" | "bereitschaft", typId: number) {
    if (!radiererAuswahl) return;
    setBusy(true);
    if (art === "zuweisung") {
      for (const z of gesammelteZuweisungen(radiererAuswahl).filter((z) => z.schichtart_id === typId)) {
        await api(`/zuweisungen/${z.id}?kommentareBehalten=1&planungseinheitId=${z.peId}`, { method: "DELETE" });
      }
    } else {
      for (const b of gesammelteBereitschaften(radiererAuswahl).filter((b) => b.bereitschaftsart_id === typId)) {
        await api(`/bereitschaften/${b.id}`, { method: "DELETE" });
      }
    }
    setBusy(false);
    load();
  }

  function radiererAlleLoeschen() {
    if (!radiererAuswahl) return;
    const zellen = radiererAuswahl;
    setRadiererAuswahl(null);
    batchLoeschen(zellen);
  }

  // Schliesst den Dialog automatisch, sobald in der markierten Auswahl nichts mehr uebrig ist
  // (z. B. nachdem alle vorkommenden Arten einzeln geloescht wurden).
  useEffect(() => {
    if (!radiererAuswahl) return;
    if (gesammelteZuweisungen(radiererAuswahl).length + gesammelteBereitschaften(radiererAuswahl).length === 0) {
      setRadiererAuswahl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datenNachPe, radiererAuswahl]);

  function zieheZelleHinzu(peId: number, benutzerId: number, datum: string) {
    dragZellenRef.current.set(`${peId}|${benutzerId}|${datum}`, { peId, benutzerId, datum });
    setDragTick((t) => t + 1);
  }

  function zelleMouseDown(peId: number, benutzerId: number, datum: string) {
    if (!werkzeug || busy) return;
    if (werkzeug.art === "vorlage") {
      // Eine Vorlage spannt bereits mehrere Tage auf -- kein Ziehen noetig, sofortige Zuweisung.
      zelleKlick(peId, benutzerId, datum);
      return;
    }
    dragZellenRef.current = new Map();
    dragZeileRef.current = { peId, benutzerId };
    dragLetzterIndexRef.current = tage.indexOf(datum);
    setDragAktiv(true);
    zieheZelleHinzu(peId, benutzerId, datum);
  }

  function zelleMouseEnter(peId: number, benutzerId: number, datum: string) {
    if (!dragAktiv || !dragZeileRef.current) return;
    // Nur innerhalb der Start-Zeile erfassen -- ein Ueberfahren anderer Mitarbeiter-/Team-Zeilen
    // waehrend des Ziehens (z. B. durch eine krumme Mausbewegung) wird ignoriert.
    if (dragZeileRef.current.peId !== peId || dragZeileRef.current.benutzerId !== benutzerId) return;
    const neuerIndex = tage.indexOf(datum);
    if (neuerIndex === -1) return;
    const letzterIndex = dragLetzterIndexRef.current ?? neuerIndex;
    const [von, bis] = letzterIndex <= neuerIndex ? [letzterIndex, neuerIndex] : [neuerIndex, letzterIndex];
    // Luecken auffuellen: der Browser feuert mouseenter nicht zuverlaessig fuer jede einzelne
    // Zelle, wenn die Maus schnell ueber die schmalen Tages-Spalten gezogen wird -- alle Tage
    // zwischen der zuletzt erfassten und der aktuellen Spalte werden daher nachtraeglich ergaenzt.
    for (let i = von; i <= bis; i++) zieheZelleHinzu(peId, benutzerId, tage[i]);
    dragLetzterIndexRef.current = neuerIndex;
  }

  useEffect(() => {
    if (!dragAktiv) return;
    function beenden() {
      setDragAktiv(false);
      const zellen = Array.from(dragZellenRef.current.values());
      dragZellenRef.current = new Map();
      dragZeileRef.current = null;
      dragLetzterIndexRef.current = null;
      setDragTick((t) => t + 1);
      if (zellen.length === 0 || !werkzeug) return;
      if (werkzeug.art === "schichtart") batchZuweisen(zellen, werkzeug.schichtart.id);
      else if (werkzeug.art === "bereitschaft") batchBereitschaftenZuweisen(zellen, werkzeug.bereitschaftsart.id);
      else if (werkzeug.art === "radierer") radiererAusloesen(zellen);
    }
    window.addEventListener("mouseup", beenden);
    return () => window.removeEventListener("mouseup", beenden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragAktiv]);

  function badgeKlick(z: Zuweisung) {
    if (busy || werkzeug) return; // mit aktivem Werkzeug uebernimmt Ziehen/Klick auf die Zelle
    setDetailId(z.id);
  }

  function freiKlick(peId: number, benutzerId: number, datum: string) {
    if (busy || werkzeug) return; // mit aktivem Werkzeug uebernimmt Ziehen/Klick auf die Zelle
    setFreischichtDetail({ peId, benutzerId, datum });
  }

  async function zuweisungLoeschen(z: Zuweisung, peId: number) {
    const anzahl = kommentareFuer(peId, z.id).length;
    const frage = anzahl > 0 ? `Zuweisung inklusive ${anzahl} Kommentar(en) löschen?` : "Zuweisung löschen?";
    if (!confirm(frage)) return;
    await api(`/zuweisungen/${z.id}`, { method: "DELETE" });
    setDetailId(null);
    load();
  }

  async function veroeffentlichen(peId: number) {
    const res = await api<{ anzahlMitarbeiter: number }>(`/planungseinheiten/${peId}/veroeffentlichen`, {
      method: "POST",
      body: JSON.stringify({ von: tage[0], bis: tage[tage.length - 1] }),
    });
    alert(`Plan veröffentlicht, ${res.anzahlMitarbeiter} Mitarbeiter benachrichtigt.`);
    load();
  }

  if (einheiten.length === 0) return <p className="empty">Keine Planer-Berechtigung.</p>;

  // Fuer das Detailfenster reicht die Suche ueber alle geladenen Teams -- dieselbe Zuweisung kann
  // (bei einem Mitarbeiter in mehreren eigenen Teams) identisch in mehreren Sektionen auftauchen.
  let detailZuweisung: Zuweisung | undefined;
  let detailPeId: number | undefined;
  if (detailId != null) {
    for (const pe of einheiten) {
      const treffer = datenNachPe.get(pe.id)?.zuweisungen.find((z) => z.id === detailId);
      if (treffer) {
        detailZuweisung = treffer;
        detailPeId = pe.id;
        break;
      }
    }
  }

  const monatLabel = new Date(jahr, monat - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <div className="page">
      <h1>Plantafel</h1>

      <div className="toolbar">
        <button onClick={() => monatWechseln(-1)}>← Vormonat</button>
        <span style={{ minWidth: "10rem", textAlign: "center" }}>{monatLabel}</span>
        <button onClick={() => monatWechseln(1)}>Nächster Monat →</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card palette">
        <div className="palette-gruppe">
          <span className="palette-label">Einzelschichten</span>
          {(() => {
            const { dienst, abwesenheit } = nachDienstUndAbwesenheitGruppiert(schichtarten.filter((sa) => !sa.archiviert));
            const knopf = (sa: Schichtart) => (
              <button
                key={sa.id}
                type="button"
                className={`palette-item${werkzeug?.art === "schichtart" && werkzeug.schichtart.id === sa.id ? " aktiv" : ""}`}
                style={{ background: sa.farbe, color: kontrastfarbe(sa.farbe) }}
                title={sa.bezeichnung}
                onClick={() => setWerkzeug({ art: "schichtart", schichtart: sa })}
              >
                {sa.kuerzel}
              </button>
            );
            return (
              <>
                {dienst.length > 0 && (
                  <>
                    <span className="palette-unterlabel">Dienste</span>
                    {dienst.map(knopf)}
                  </>
                )}
                {abwesenheit.length > 0 && (
                  <>
                    <span className="palette-unterlabel">Abwesenheiten</span>
                    {abwesenheit.map(knopf)}
                  </>
                )}
              </>
            );
          })()}
          {schichtarten.length > 0 && schichtarten.every((sa) => sa.archiviert) && <span className="empty">Keine aktiven Schichtarten.</span>}
        </div>

        <div className="palette-gruppe">
          <span className="palette-label">Bereitschaften</span>
          {[...bereitschaftsarten.filter((ba) => !ba.archiviert)]
            .sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, "de"))
            .map((ba) => (
              <button
                key={ba.id}
                type="button"
                className={`palette-item${werkzeug?.art === "bereitschaft" && werkzeug.bereitschaftsart.id === ba.id ? " aktiv" : ""}`}
                style={{ background: ba.farbe, color: kontrastfarbe(ba.farbe) }}
                title={ba.bezeichnung}
                onClick={() => setWerkzeug({ art: "bereitschaft", bereitschaftsart: ba })}
              >
                {ba.kuerzel}
              </button>
            ))}
          {bereitschaftsarten.length === 0 && <span className="empty">Keine Bereitschaftsarten angelegt.</span>}
        </div>

        <div className="palette-gruppe palette-werkzeuge">
          <button
            type="button"
            className={`palette-item palette-radierer${werkzeug?.art === "radierer" ? " aktiv" : ""}`}
            title="Zugewiesene Schicht durch Klick auf das Kürzel entfernen"
            onClick={() => setWerkzeug({ art: "radierer" })}
          >
            Radierer
          </button>
          <button type="button" className="palette-item palette-aufheben" disabled={!werkzeug} onClick={() => setWerkzeug(null)}>
            × Auswahl aufheben
          </button>
        </div>

        <span className="hint">
          {werkzeug?.art === "schichtart" &&
            `„${werkzeug.schichtart.bezeichnung}" ausgewählt – Zellen anklicken oder durch Ziehen mehrere Tage auf einmal zuweisen.`}
          {werkzeug?.art === "bereitschaft" &&
            `„${werkzeug.bereitschaftsart.bezeichnung}" ausgewählt – Zellen anklicken oder durch Ziehen mehrere Tage auf einmal zuweisen (zusätzlich zu einer eventuell vorhandenen Schicht).`}
          {werkzeug?.art === "vorlage" &&
            `„${werkzeug.vorlage.bezeichnung}" ausgewählt – Zelle anklicken, sie ist der erste Tag des Blocks.`}
          {werkzeug?.art === "radierer" &&
            "Radierer aktiv – Kürzel anklicken oder über mehrere Zellen ziehen, um Zuweisungen und Bereitschaften der Zelle zu entfernen."}
          {!werkzeug &&
            "Werkzeug wählen, um Schichten zuzuweisen. Ohne Werkzeug öffnet ein Klick auf ein Kürzel oder eine Freischicht die Details."}
        </span>
      </div>

      {einheiten.map((pe) => {
        const daten = datenNachPe.get(pe.id);
        const vorlagen = vorlagenNachPe.get(pe.id) ?? [];
        return (
          <section key={pe.id} className="plantafel-team-sektion">
            <div className="toolbar">
              <h2>{pe.name}</h2>
              <button onClick={() => veroeffentlichen(pe.id)}>Plan veröffentlichen</button>
            </div>

            <div className="card palette">
              <div className="palette-gruppe">
                <span className="palette-label">Schichtblöcke</span>
                {vorlagen
                  .filter((v) => !v.enthaeltArchivierte)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`palette-item palette-vorlage${
                        werkzeug?.art === "vorlage" && werkzeug.peId === pe.id && werkzeug.vorlage.id === v.id ? " aktiv" : ""
                      }`}
                      title={v.eintraege.map((e) => `Tag ${e.tag_offset + 1}: ${e.kuerzel}`).join(", ")}
                      onClick={() => setWerkzeug({ art: "vorlage", peId: pe.id, vorlage: v })}
                    >
                      {v.bezeichnung}
                    </button>
                  ))}
                {vorlagen.length === 0 && <span className="empty">Keine Schichtblock-Vorlagen angelegt.</span>}
              </div>
            </div>

            {!daten ? (
              <div className="center-info">Lade…</div>
            ) : (
              <div className="plantafel-scroll">
                <table
                  className={`table plantafel${werkzeug ? " stempel-aktiv" : ""}${dragAktiv ? " ziehen-aktiv" : ""}`}
                  onDragStart={(e) => e.preventDefault()}
                >
                  <thead>
                    <tr>
                      <th>Mitarbeiter</th>
                      {tage.map((t) => {
                        const klassen = [istWochenende(t) ? "wochenende" : "", feiertage.has(t) ? "feiertag" : ""]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <th key={t} className={klassen}>
                            <div className="tag-nr">{Number(t.slice(8, 10))}</div>
                            <div className="tag-wt">{wochentagKurz(t)}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {daten.mitarbeiter.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        {tage.map((t) => {
                          const treffer = zellenZuweisungen(pe.id, m.id, t);
                          const klassen = ["plan-zelle", istWochenende(t) ? "wochenende" : "", feiertage.has(t) ? "feiertag" : ""]
                            .filter(Boolean)
                            .join(" ");
                          const wirdGezogen = dragZellenRef.current.has(`${pe.id}|${m.id}|${t}`);
                          // Pro Tag soll ein Mitarbeiter nur eine Schicht haben -- mehrere
                          // Zuweisungen am selben Tag sind ein Datenfehler (z. B. durch eine
                          // Schichtboersen-Vergabe ohne Konfliktpruefung) und werden zusaetzlich zur
                          // normalen Schicht-Zeile als Konflikt markiert. Die einzelnen Badges
                          // bleiben dabei klickbar, damit der Planer den Konflikt direkt hier
                          // aufloesen kann (z. B. eine der beiden Zuweisungen loeschen).
                          const konflikt = treffer.length > 1;
                          const bereitschaften = zellenBereitschaften(pe.id, m.id, t);
                          return (
                            <td
                              key={t}
                              className={`${klassen}${wirdGezogen ? " ziehen-markiert" : ""}`}
                              onMouseDown={() => zelleMouseDown(pe.id, m.id, t)}
                              onMouseEnter={() => zelleMouseEnter(pe.id, m.id, t)}
                            >
                              <div className={`zelle-schicht-zeile${konflikt ? " zelle-konflikt" : ""}`} title={konflikt ? "Mehrere Schichten am selben Tag!" : undefined}>
                                {treffer.length > 0 ? (
                                  treffer.map((z) => {
                                    const sa = schichtarten.find((s) => s.id === z.schichtart_id);
                                    if (!sa) return null;
                                    const anzahlKommentare = kommentareFuer(pe.id, z.id).length;
                                    return (
                                      <span
                                        key={z.id}
                                        className={`badge${z.status === "entwurf" ? " badge-entwurf" : ""}`}
                                        style={{ background: sa.farbe, color: kontrastfarbe(sa.farbe) }}
                                        title={`${sa.bezeichnung} (${z.status})${anzahlKommentare > 0 ? ` · ${anzahlKommentare} Kommentar(e)` : ""}`}
                                        onMouseDown={(e) => {
                                          e.stopPropagation();
                                          zelleMouseDown(pe.id, z.benutzer_id, z.datum);
                                        }}
                                        onMouseEnter={(e) => {
                                          e.stopPropagation();
                                          zelleMouseEnter(pe.id, z.benutzer_id, z.datum);
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          badgeKlick(z);
                                        }}
                                      >
                                        {sa.kuerzel}
                                        {anzahlKommentare > 0 && <span className="kommentar-marker" />}
                                      </span>
                                    );
                                  })
                                ) : (
                                  (() => {
                                    const freiKommentare = freischichtKommentareFuer(pe.id, m.id, t);
                                    return (
                                      <span
                                        className="freischicht-hinweis"
                                        title={freiKommentare.length > 0 ? `${freiKommentare.length} Kommentar(e)` : undefined}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          freiKlick(pe.id, m.id, t);
                                        }}
                                      >
                                        frei
                                        {freiKommentare.length > 0 && <span className="kommentar-marker" />}
                                      </span>
                                    );
                                  })()
                                )}
                              </div>
                              {bereitschaften.length > 0 && (
                                <div className="zelle-bereitschaft-zeile">
                                  {bereitschaften.map((b) => {
                                    const ba = bereitschaftsarten.find((x) => x.id === b.bereitschaftsart_id);
                                    if (!ba) return null;
                                    return (
                                      <span
                                        key={b.id}
                                        className="bereitschaft-chip"
                                        style={{ background: ba.farbe, color: kontrastfarbe(ba.farbe) }}
                                        title={ba.bezeichnung}
                                        onMouseDown={(e) => {
                                          e.stopPropagation();
                                          zelleMouseDown(pe.id, b.benutzer_id, b.datum);
                                        }}
                                        onMouseEnter={(e) => {
                                          e.stopPropagation();
                                          zelleMouseEnter(pe.id, b.benutzer_id, b.datum);
                                        }}
                                      >
                                        {ba.kuerzel}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {daten.mitarbeiter.length === 0 && (
                      <tr>
                        <td colSpan={tage.length + 1} className="empty">
                          Keine Mitarbeiter in diesem Team.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <p className="hint">
        Legende: gestrichelter Rahmen = Entwurf, ohne Rahmen = veröffentlicht. Punkt am Kürzel = Kommentar vorhanden.
        Wochenenden grau, Feiertage gelb hinterlegt.
      </p>

      {detailZuweisung && detailPeId != null && (
        <ZuweisungDetail
          zuweisung={detailZuweisung}
          schichtart={schichtarten.find((s) => s.id === detailZuweisung!.schichtart_id)}
          mitarbeiterName={datenNachPe.get(detailPeId)?.mitarbeiter.find((m) => m.id === detailZuweisung!.benutzer_id)?.name ?? ""}
          kommentare={kommentareFuer(detailPeId, detailZuweisung.id)}
          onSchliessen={() => setDetailId(null)}
          onGeaendert={load}
          onLoeschen={() => zuweisungLoeschen(detailZuweisung!, detailPeId!)}
        />
      )}

      {freischichtDetail && (
        <FreischichtDetail
          benutzerId={freischichtDetail.benutzerId}
          datum={freischichtDetail.datum}
          planungseinheitId={freischichtDetail.peId}
          mitarbeiterName={datenNachPe.get(freischichtDetail.peId)?.mitarbeiter.find((m) => m.id === freischichtDetail.benutzerId)?.name ?? ""}
          kommentare={freischichtKommentareFuer(freischichtDetail.peId, freischichtDetail.benutzerId, freischichtDetail.datum)}
          onSchliessen={() => setFreischichtDetail(null)}
          onGeaendert={load}
        />
      )}

      {radiererAuswahl && (
        <RadiererTypAuswahlDialog
          anzahlZellen={radiererAuswahl.length}
          zuweisungen={gesammelteZuweisungen(radiererAuswahl)}
          bereitschaften={gesammelteBereitschaften(radiererAuswahl)}
          schichtarten={schichtarten}
          bereitschaftsarten={bereitschaftsarten}
          onTypLoeschen={radiererTypLoeschen}
          onAlle={radiererAlleLoeschen}
          onAbbrechen={() => setRadiererAuswahl(null)}
        />
      )}
    </div>
  );
}

// Detailfenster einer Zuweisung: Kommentare lesen, anlegen (oeffentlich oder nur fuer Planer)
// und loeschen, sowie die Zuweisung selbst entfernen.
function ZuweisungDetail({
  zuweisung,
  schichtart,
  mitarbeiterName,
  kommentare,
  onSchliessen,
  onGeaendert,
  onLoeschen,
}: {
  zuweisung: Zuweisung;
  schichtart?: Schichtart;
  mitarbeiterName: string;
  kommentare: Kommentar[];
  onSchliessen: () => void;
  onGeaendert: () => void;
  onLoeschen: () => void;
}) {
  const [text, setText] = useState("");
  const [sichtbarkeit, setSichtbarkeit] = useState<"oeffentlich" | "nur_planer">("nur_planer");
  const [fehler, setFehler] = useState<string | null>(null);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setFehler(null);
    try {
      await api(`/zuweisungen/${zuweisung.id}/kommentare`, {
        method: "POST",
        body: JSON.stringify({ text, sichtbarkeit }),
      });
      setText("");
      onGeaendert();
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  async function kommentarLoeschen(id: number) {
    await api(`/kommentare/${id}`, { method: "DELETE" });
    onGeaendert();
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onSchliessen} />
      <div className="popover">
        <div className="popover-kopf">
          <div>
            {schichtart && (
              <span className="badge" style={{ background: schichtart.farbe, color: kontrastfarbe(schichtart.farbe) }}>
                {schichtart.kuerzel}
              </span>
            )}{" "}
            <strong>{schichtart?.bezeichnung}</strong>
            <div className="hint">
              {mitarbeiterName} · {formatDatum(zuweisung.datum)}{" "}
              <span className={`status status-${zuweisung.status}`}>
                {zuweisung.status === "entwurf" ? "Entwurf" : "Veröffentlicht"}
              </span>
            </div>
          </div>
          <button type="button" className="popover-schliessen" onClick={onSchliessen} title="Schließen">
            ×
          </button>
        </div>

        <div className="kommentar-liste">
          {kommentare.length === 0 && <p className="empty">Noch keine Kommentare.</p>}
          {kommentare.map((k) => (
            <div key={k.id} className="kommentar-eintrag">
              <div className="kommentar-meta">
                <span>
                  {k.autor_name} · {formatDatumZeit(k.erstellt_am)}
                </span>
                <span className={`sichtbarkeit-chip${k.sichtbarkeit === "nur_planer" ? " sichtbarkeit-nur-planer" : ""}`}>
                  {k.sichtbarkeit === "nur_planer" ? "Nur Planer" : "Öffentlich"}
                </span>
                <button type="button" onClick={() => kommentarLoeschen(k.id)} title="Kommentar löschen">
                  ×
                </button>
              </div>
              <div>{k.text}</div>
            </div>
          ))}
        </div>

        <form onSubmit={anlegen} className="kommentar-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Kommentar…" rows={2} />
          <div className="zeile">
            <select value={sichtbarkeit} onChange={(e) => setSichtbarkeit(e.target.value as "oeffentlich" | "nur_planer")}>
              <option value="nur_planer">Nur Planer</option>
              <option value="oeffentlich">Öffentlich</option>
            </select>
            <button type="submit" disabled={!text.trim()}>
              Kommentar speichern
            </button>
          </div>
        </form>
        {fehler && <div className="error">{fehler}</div>}

        <div className="popover-fuss">
          <button type="button" onClick={onLoeschen}>
            Zuweisung löschen
          </button>
        </div>
      </div>
    </>
  );
}

// Detailfenster einer Freischicht (Tag ohne Zuweisung): auch hier koennen Planer Kommentare
// hinterlegen -- z. B. um zu vermerken, warum bewusst niemand eingeteilt ist. Ohne
// "Zuweisung loeschen", da es keine Zuweisung gibt.
function FreischichtDetail({
  benutzerId,
  datum,
  planungseinheitId,
  mitarbeiterName,
  kommentare,
  onSchliessen,
  onGeaendert,
}: {
  benutzerId: number;
  datum: string;
  planungseinheitId: number;
  mitarbeiterName: string;
  kommentare: FreischichtKommentar[];
  onSchliessen: () => void;
  onGeaendert: () => void;
}) {
  const [text, setText] = useState("");
  const [sichtbarkeit, setSichtbarkeit] = useState<"oeffentlich" | "nur_planer">("nur_planer");
  const [fehler, setFehler] = useState<string | null>(null);

  async function anlegen(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setFehler(null);
    try {
      await api("/freischicht-kommentare", {
        method: "POST",
        body: JSON.stringify({ benutzerId, datum, planungseinheitId, text, sichtbarkeit }),
      });
      setText("");
      onGeaendert();
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  async function kommentarLoeschen(id: number) {
    await api(`/freischicht-kommentare/${id}`, { method: "DELETE" });
    onGeaendert();
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onSchliessen} />
      <div className="popover">
        <div className="popover-kopf">
          <div>
            <strong>Freischicht</strong>
            <div className="hint">
              {mitarbeiterName} · {formatDatum(datum)}
            </div>
          </div>
          <button type="button" className="popover-schliessen" onClick={onSchliessen} title="Schließen">
            ×
          </button>
        </div>

        <div className="kommentar-liste">
          {kommentare.length === 0 && <p className="empty">Noch keine Kommentare.</p>}
          {kommentare.map((k) => (
            <div key={k.id} className="kommentar-eintrag">
              <div className="kommentar-meta">
                <span>
                  {k.autor_name} · {formatDatumZeit(k.erstellt_am)}
                </span>
                <span className={`sichtbarkeit-chip${k.sichtbarkeit === "nur_planer" ? " sichtbarkeit-nur-planer" : ""}`}>
                  {k.sichtbarkeit === "nur_planer" ? "Nur Planer" : "Öffentlich"}
                </span>
                <button type="button" onClick={() => kommentarLoeschen(k.id)} title="Kommentar löschen">
                  ×
                </button>
              </div>
              <div>{k.text}</div>
            </div>
          ))}
        </div>

        <form onSubmit={anlegen} className="kommentar-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Kommentar…" rows={2} />
          <div className="zeile">
            <select value={sichtbarkeit} onChange={(e) => setSichtbarkeit(e.target.value as "oeffentlich" | "nur_planer")}>
              <option value="nur_planer">Nur Planer</option>
              <option value="oeffentlich">Öffentlich</option>
            </select>
            <button type="submit" disabled={!text.trim()}>
              Kommentar speichern
            </button>
          </div>
        </form>
        {fehler && <div className="error">{fehler}</div>}
      </div>
    </>
  );
}

// Radierer auf einer Markierung (eine oder mehrere Zellen), die mehr als eine Schicht-/
// Bereitschaftsart enthaelt: zeigt alle in der Markierung vorkommenden Arten gesammelt an
// (nicht Zelle fuer Zelle) und laesst gezielt eine Art loeschen, statt kommentarlos alles zu
// entfernen. Bleibt offen, bis die Markierung leer ist -- so lassen sich nacheinander mehrere
// Arten entfernen, ohne den Dialog neu oeffnen zu muessen.
function RadiererTypAuswahlDialog({
  anzahlZellen,
  zuweisungen,
  bereitschaften,
  schichtarten,
  bereitschaftsarten,
  onTypLoeschen,
  onAlle,
  onAbbrechen,
}: {
  anzahlZellen: number;
  zuweisungen: Zuweisung[];
  bereitschaften: Bereitschaft[];
  schichtarten: Schichtart[];
  bereitschaftsarten: Bereitschaftsart[];
  onTypLoeschen: (art: "zuweisung" | "bereitschaft", typId: number) => void;
  onAlle: () => void;
  onAbbrechen: () => void;
}) {
  const zuweisungenNachTyp = new Map<number, number>();
  for (const z of zuweisungen) zuweisungenNachTyp.set(z.schichtart_id, (zuweisungenNachTyp.get(z.schichtart_id) ?? 0) + 1);
  const bereitschaftenNachTyp = new Map<number, number>();
  for (const b of bereitschaften) bereitschaftenNachTyp.set(b.bereitschaftsart_id, (bereitschaftenNachTyp.get(b.bereitschaftsart_id) ?? 0) + 1);

  return (
    <>
      <div className="popover-backdrop" onClick={onAbbrechen} />
      <div className="popover">
        <div className="popover-kopf">
          <div>
            <strong>Mehrere Schicht-/Bereitschaftsarten markiert</strong>
            <div className="hint">{anzahlZellen} Zelle(n) markiert</div>
          </div>
          <button type="button" className="popover-schliessen" onClick={onAbbrechen} title="Schließen">
            ×
          </button>
        </div>

        <p className="hint">Welche Art soll aus der Markierung gelöscht werden?</p>

        <ul className="radierer-auswahl-liste">
          {Array.from(zuweisungenNachTyp.entries()).map(([schichtartId, anzahl]) => {
            const sa = schichtarten.find((s) => s.id === schichtartId);
            return (
              <li key={`z${schichtartId}`}>
                <span className="badge" style={{ background: sa?.farbe }}>
                  {sa?.kuerzel}
                </span>
                <span>
                  {sa?.bezeichnung} ({anzahl}×)
                </span>
                <button type="button" onClick={() => onTypLoeschen("zuweisung", schichtartId)}>
                  Diese Schichtart löschen
                </button>
              </li>
            );
          })}
          {Array.from(bereitschaftenNachTyp.entries()).map(([bereitschaftsartId, anzahl]) => {
            const ba = bereitschaftsarten.find((x) => x.id === bereitschaftsartId);
            return (
              <li key={`b${bereitschaftsartId}`}>
                <span className="bereitschaft-chip" style={{ background: ba?.farbe }}>
                  {ba?.kuerzel}
                </span>
                <span>
                  {ba?.bezeichnung} ({anzahl}×)
                </span>
                <button type="button" onClick={() => onTypLoeschen("bereitschaft", bereitschaftsartId)}>
                  Diese Bereitschaftsart löschen
                </button>
              </li>
            );
          })}
        </ul>

        <div className="popover-fuss">
          <button type="button" onClick={onAlle}>
            Alle löschen
          </button>
          <button type="button" onClick={onAbbrechen}>
            Abbrechen
          </button>
        </div>
      </div>
    </>
  );
}
