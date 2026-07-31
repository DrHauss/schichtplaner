import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import TerminListe from "../components/TerminListe";
import { RasterSpalte, RasterZelle } from "../components/RasterMatrix";
import { formatDatum, formatDatumZeit } from "../lib/datum";

interface AbfrageDaten {
  teilnehmer: { benutzerId: number | null; name: string; wunschAnzahl: number | null; abgegebenAm: string | null };
  ausschreibung: {
    titel: string;
    zeitraum_von: string;
    zeitraum_bis: string;
    bewerbungsfrist: string;
    status: string;
    min_bloecke: number | null;
  };
  spalten: RasterSpalte[];
  zeilen: { benutzerId: number | null; zusagenAnzahl: number; vollstaendig: boolean; zellen: Record<number, RasterZelle> }[];
}

// Zugang per persoenlichem Link ohne Login (Konzept Kap. 3.3): eigenstaendige Seite ausserhalb
// von RequireAuth/Layout, angesprochen ueber /abfrage/:token.
export default function AbfrageTokenPage() {
  const { token } = useParams();
  const [daten, setDaten] = useState<AbfrageDaten | null>(null);
  const [zellen, setZellen] = useState<Record<number, RasterZelle>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function laden() {
    return api<AbfrageDaten>(`/abfrage/${token}`).then((d) => {
      setDaten(d);
      const eigeneZeile = d.zeilen.find((z) => z.benutzerId === d.teilnehmer.benutzerId);
      setZellen(eigeneZeile?.zellen ?? {});
      return d;
    });
  }

  useEffect(() => {
    laden()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  async function antworten(schichtblockId: number, antwort: string) {
    const res = await api<{ ok: boolean; warnungen: Record<number, { meldung: string }[]> }>(`/abfrage/${token}/antworten`, {
      method: "PUT",
      body: JSON.stringify({ antworten: [{ schichtblockId, antwort }] }),
    });
    await laden();
    return (res.warnungen?.[schichtblockId] ?? []).map((w) => w.meldung);
  }

  if (loading) return <div className="center-info">Lade…</div>;
  if (error || !daten) {
    return (
      <div className="center-info">
        <p className="error">{error ?? "Link ungültig."}</p>
      </div>
    );
  }

  const eigeneZeile = daten.zeilen.find((z) => z.benutzerId === daten.teilnehmer.benutzerId);
  const mindestZusagen = daten.ausschreibung.min_bloecke;

  return (
    <div className="abfrage-token-page">
      <header className="abfrage-token-kopf">
        <div className="brand">SchichtWeb</div>
        <h1>{daten.ausschreibung.titel}</h1>
        <p className="hint">
          Zeitraum {formatDatum(daten.ausschreibung.zeitraum_von)} – {formatDatum(daten.ausschreibung.zeitraum_bis)} · Frist{" "}
          {formatDatumZeit(daten.ausschreibung.bewerbungsfrist)}
        </p>
        <p>
          Hallo {daten.teilnehmer.name}
          {daten.teilnehmer.wunschAnzahl != null && <> · Wunsch: ca. {daten.teilnehmer.wunschAnzahl} Dienste</>}
        </p>
        {mindestZusagen != null && eigeneZeile && (
          <p className={eigeneZeile.vollstaendig ? "hint" : "raster-gesperrt-hinweis"}>
            {eigeneZeile.vollstaendig
              ? `Danke, du hast die Mindestanzahl von ${mindestZusagen} Zusage(n) erreicht.`
              : `Bitte noch für mindestens ${mindestZusagen} Termine mit „Ja" antworten (aktuell ${eigeneZeile.zusagenAnzahl}).`}
          </p>
        )}
        {daten.ausschreibung.status === "geschlossen" && <p className="error">Die Bewerbungsfrist ist abgelaufen.</p>}
      </header>
      <TerminListe
        spalten={daten.spalten}
        zellen={zellen}
        onAntwort={daten.ausschreibung.status === "geschlossen" ? async () => [] : antworten}
      />
    </div>
  );
}
