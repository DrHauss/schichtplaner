import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { api } from "../api/client";
import { hexZuRgb, kontrastfarbe } from "../lib/farbe";

interface ZuweisungKommentar {
  id: number;
  autorName: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstelltAm: string;
}

interface Zuweisung {
  id: number;
  datum: string;
  benutzerId: number;
  mitarbeiterName: string;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
  beginn: string;
  ende: string;
  ganztags?: boolean;
  // Der Server liefert 'nur_planer'-Kommentare nur an Planer der jeweiligen Einheit bzw. Admins.
  kommentare?: ZuweisungKommentar[];
}

interface FreischichtKommentar {
  id: number;
  benutzerId: number;
  datum: string;
  autorName: string;
  text: string;
  sichtbarkeit: "oeffentlich" | "nur_planer";
  erstelltAm: string;
}

interface BereitschaftZeile {
  id: number;
  datum: string;
  benutzerId: number;
  mitarbeiterName: string;
  bereitschaftsartId: number;
  kuerzel: string;
  bezeichnung: string;
  farbe: string;
}

interface PlanungseinheitUebersicht {
  id: number;
  name: string;
  standort: string | null;
  mitarbeiter: { id: number; name: string }[];
  zuweisungen: Zuweisung[];
  freischichtKommentare?: FreischichtKommentar[];
}

interface FeiertagEintrag {
  datum: string;
  bezeichnung: string;
  istFrei: boolean;
}

const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

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
  const d = new Date(`${datumIso}T00:00:00`);
  const tag = d.getDay();
  return tag === 0 || tag === 6;
}

// Vorname- + Nachname-Initiale (z. B. "Anna Beispiel" -> "AB") -- kompakt genug, um wie ein
// normales Schicht-Kuerzel in die feste Spaltenbreite zu passen, aber anders als eine reine
// Anzahl direkt erkennbar, wer gemeint ist.
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "";
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

// Teamuebergreifende, rein lesende Uebersicht der veroeffentlichten Schichten aller
// Planungseinheiten -- fuer alle angemeldeten Nutzer sichtbar, nicht nur fuer Planer oder
// Mitglieder der jeweiligen Einheit. Entwuerfe bleiben bewusst nur in der Plantafel der
// jeweiligen Planer sichtbar. Monatsweise Ansicht, da ein Wochenraster fuer den
// Gesamtueberblick ueber ein Team zu kleinteilig ist.
export default function TeamUebersichtPage() {
  const [{ jahr, monat }, setMonat] = useState(heuteJahrMonat());
  const [einheiten, setEinheiten] = useState<PlanungseinheitUebersicht[]>([]);
  const [bereitschaften, setBereitschaften] = useState<BereitschaftZeile[]>([]);
  const [feiertage, setFeiertage] = useState<FeiertagEintrag[]>([]);
  const [loading, setLoading] = useState(true);

  const tage = useMemo(() => tageDesMonats(jahr, monat), [jahr, monat]);
  const feiertagNachDatum = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of feiertage) if (f.istFrei) map.set(f.datum, f.bezeichnung);
    return map;
  }, [feiertage]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ planungseinheiten: PlanungseinheitUebersicht[]; bereitschaften: BereitschaftZeile[] }>(
        `/uebersicht?von=${tage[0]}&bis=${tage[tage.length - 1]}`
      ),
      api<FeiertagEintrag[]>(`/feiertage?jahr=${jahr}`),
    ])
      .then(([uebersicht, f]) => {
        setEinheiten(uebersicht.planungseinheiten);
        setBereitschaften(uebersicht.bereitschaften);
        setFeiertage(f);
      })
      .finally(() => setLoading(false));
  }, [tage, jahr]);

  function monatWechseln(delta: number) {
    setMonat(({ jahr, monat }) => {
      const d = new Date(jahr, monat - 1 + delta, 1);
      return { jahr: d.getFullYear(), monat: d.getMonth() + 1 };
    });
  }

  function tagKlasse(t: string): string {
    const klassen: string[] = [];
    if (istWochenende(t)) klassen.push("wochenende");
    if (feiertagNachDatum.has(t)) klassen.push("feiertag");
    return klassen.join(" ");
  }

  const monatLabel = new Date(jahr, monat - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  // Bereitschaften sind global (nicht team-gebunden) und werden daher in einem einzigen Block vor
  // allen Teams gezeigt, eine Zeile je Bereitschaftsart.
  const bereitschaftsartenListe = useMemo(() => {
    const nachId = new Map<number, { id: number; kuerzel: string; bezeichnung: string; farbe: string }>();
    for (const b of bereitschaften) {
      if (!nachId.has(b.bereitschaftsartId)) {
        nachId.set(b.bereitschaftsartId, { id: b.bereitschaftsartId, kuerzel: b.kuerzel, bezeichnung: b.bezeichnung, farbe: b.farbe });
      }
    }
    return Array.from(nachId.values()).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, "de"));
  }, [bereitschaften]);

  // Legende: alle in diesem Monat tatsaechlich vorkommenden Schichtarten (ueber alle Teams) --
  // dedupliziert nach Kuerzel, da Zuweisungen keine eigene Schichtart-ID mitliefern.
  const schichtartenListe = useMemo(() => {
    const nachKuerzel = new Map<string, { kuerzel: string; bezeichnung: string; farbe: string }>();
    for (const pe of einheiten) {
      for (const z of pe.zuweisungen) {
        if (!nachKuerzel.has(z.kuerzel)) nachKuerzel.set(z.kuerzel, { kuerzel: z.kuerzel, bezeichnung: z.bezeichnung, farbe: z.farbe });
      }
    }
    return Array.from(nachKuerzel.values()).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, "de"));
  }, [einheiten]);

  // Die Bereitschaften-Zeilen zeigen aus Platzgruenden nur Initialen (siehe initialen()) --
  // welche Bereitschaftsart eine Zeile ist, steht bereits als Zeilenbeschriftung in der Tabelle
  // selbst, muss also nicht zusaetzlich in der Legende wiederholt werden. Was die Legende
  // stattdessen aufloesen muss, sind die Initialen selbst (mehrdeutig ohne Tooltip/Hover, das im
  // PDF-Export ohnehin nicht funktioniert).
  const bereitschaftInitialenListe = useMemo(() => {
    const nachBenutzer = new Map<number, { benutzerId: number; name: string; initialen: string }>();
    for (const b of bereitschaften) {
      if (!nachBenutzer.has(b.benutzerId)) {
        nachBenutzer.set(b.benutzerId, { benutzerId: b.benutzerId, name: b.mitarbeiterName, initialen: initialen(b.mitarbeiterName) });
      }
    }
    return Array.from(nachBenutzer.values()).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [bereitschaften]);

  // Echter PDF-Export statt Browser-Druckdialog: der Druckdialog fuegt browserseitig immer eine
  // eigene Kopf-/Fusszeile mit URL/Titel ein, die sich per CSS nicht unterdruecken laesst. jsPDF +
  // jspdf-autotable erzeugen stattdessen ein eigenstaendiges PDF ohne Browser-Chrome, mit fuer
  // alle Tabellen (Bereitschaften-Block + jedes Team) identischen Spaltenbreiten -- das
  // garantiert dieselbe Spaltenausrichtung wie in der Bildschirmansicht, unabhaengig vom Inhalt
  // der jeweiligen Tabelle.
  const NAME_SPALTE_MM = 30;
  const TAG_SPALTE_MM = 8;
  const SEITENRAND_MM = 6;

  // Exakt dieselben Farbwerte wie .uebersicht-monat th/td.wochenende/.feiertag in styles.css --
  // im PDF muessen Wochenenden/Feiertage genauso erkennbar sein wie in der Bildschirmansicht.
  function tagTintFarbe(t: string): [number, number, number] | null {
    const feiertag = feiertagNachDatum.has(t);
    const wochenende = istWochenende(t);
    if (feiertag && wochenende) return [253, 230, 138];
    if (feiertag) return [254, 243, 199];
    if (wochenende) return [241, 245, 249];
    return null;
  }

  function pdfExportieren() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const seitenHoehe = doc.internal.pageSize.getHeight();
    const spaltenStile: Record<number, { cellWidth: number }> = { 0: { cellWidth: NAME_SPALTE_MM } };
    tage.forEach((_, i) => {
      spaltenStile[i + 1] = { cellWidth: TAG_SPALTE_MM };
    });
    const kopfzeile = ["", ...tage.map((t) => `${Number(t.slice(8, 10))}\n${wochentagKurz(t)}`)];

    doc.setFontSize(14);
    doc.setTextColor(21, 50, 95);
    doc.text(`Team-Übersicht -- ${monatLabel}`, SEITENRAND_MM, 10);
    let naechsteStartY = 16;

    function abschnittZeichnen(titel: string, zeilen: { label: string; zellen: { text: string; farbe?: string }[] }[]) {
      if (naechsteStartY > seitenHoehe - 30) {
        doc.addPage();
        naechsteStartY = 12;
      }
      doc.setFontSize(11);
      doc.setTextColor(21, 50, 95);
      doc.text(titel, SEITENRAND_MM, naechsteStartY);
      naechsteStartY += 4;
      const body = zeilen.map((z) => [z.label, ...z.zellen.map((c) => c.text)]);
      const farbeNachZelle = new Map<string, string>();
      zeilen.forEach((z, zeilenIdx) => {
        z.zellen.forEach((c, spaltenIdx) => {
          if (c.farbe) farbeNachZelle.set(`${zeilenIdx}-${spaltenIdx + 1}`, c.farbe);
        });
      });
      autoTable(doc, {
        head: [kopfzeile],
        body,
        startY: naechsteStartY,
        margin: { left: SEITENRAND_MM, right: SEITENRAND_MM, bottom: 12 },
        theme: "grid",
        styles: { fontSize: 5.5, cellPadding: 0.6, overflow: "linebreak", lineWidth: 0.1, valign: "middle", halign: "center" },
        headStyles: { fillColor: [255, 255, 255], textColor: [21, 50, 95], fontSize: 5.5, halign: "center", fontStyle: "bold" },
        columnStyles: { ...spaltenStile, 0: { ...spaltenStile[0], halign: "left" } },
        rowPageBreak: "avoid",
        didParseCell: (data) => {
          if (data.column.index === 0) return;
          const tint = tagTintFarbe(tage[data.column.index - 1]);
          if (data.section !== "body") {
            if (tint) data.cell.styles.fillColor = tint;
            return;
          }
          const farbe = farbeNachZelle.get(`${data.row.index}-${data.column.index}`);
          if (farbe) {
            const rgb = hexZuRgb(farbe);
            if (rgb) {
              data.cell.styles.fillColor = rgb;
              const kontrast = hexZuRgb(kontrastfarbe(farbe));
              if (kontrast) data.cell.styles.textColor = kontrast;
            }
            return;
          }
          // Keine Zuweisung/Bereitschaft an diesem Tag -- Wochenend-/Feiertagstoenung bleibt sichtbar,
          // "frei"-Text (nur in Team-Tabellen gesetzt, s. u.) wird wie im Web dezent grau dargestellt.
          data.cell.styles.textColor = [148, 163, 184];
          if (tint) data.cell.styles.fillColor = tint;
        },
      });
      naechsteStartY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }

    if (bereitschaftsartenListe.length > 0) {
      abschnittZeichnen(
        "Bereitschaften",
        bereitschaftsartenListe.map((ba) => ({
          label: ba.bezeichnung,
          zellen: tage.map((t) => {
            const namen = bereitschaften.filter((b) => b.bereitschaftsartId === ba.id && b.datum === t).map((b) => b.mitarbeiterName);
            return { text: namen.map(initialen).join(","), farbe: namen.length > 0 ? ba.farbe : undefined };
          }),
        }))
      );
    }

    for (const pe of einheiten) {
      if (pe.mitarbeiter.length === 0) continue;
      abschnittZeichnen(
        `${pe.name}${pe.standort ? ` · ${pe.standort}` : ""}`,
        pe.mitarbeiter.map((m) => ({
          label: m.name,
          zellen: tage.map((t) => {
            const treffer = pe.zuweisungen.filter((z) => z.benutzerId === m.id && z.datum === t);
            return treffer.length > 0
              ? { text: treffer.map((z) => z.kuerzel).join("+"), farbe: treffer[0]?.farbe }
              : { text: "frei" };
          }),
        }))
      );
    }

    // Ein Legenden-Eintrag ist immer ein farbiger Kuerzel-Chip (Kuerzel steht IN der Box, wie in
    // den Team-Tabellen selbst) gefolgt vom Klartext -- fuer Bereitschaften ohne eigene Farbe wird
    // ein neutraler grauer Chip verwendet. Chip-Breite richtet sich nach der Laenge des jeweiligen
    // Kuerzels (z. B. "T" schmaler als "MAGZ"), damit kurze Kuerzel keinen unnoetigen Leerraum
    // erzeugen.
    function legendeChip(kuerzel: string, farbe: string | undefined, text: string) {
      const chipBreite = Math.max(doc.getTextWidth(kuerzel) + 3, 6.5);
      return {
        text,
        chipBreite,
        zeichneMuster: (x: number, y: number) => {
          const rgb = farbe ? hexZuRgb(farbe) ?? [148, 163, 184] : [226, 232, 240];
          doc.setFillColor(rgb[0], rgb[1], rgb[2]);
          doc.roundedRect(x, y - 3.1, chipBreite, 4, 0.9, 0.9, "F");
          const textRgb = farbe ? hexZuRgb(kontrastfarbe(farbe)) ?? [255, 255, 255] : [71, 85, 105];
          doc.setFontSize(6.3);
          doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
          doc.text(kuerzel, x + chipBreite / 2, y - 0.2, { align: "center" });
        },
      };
    }

    // Zeichnet eine Legenden-Gruppe (Ueberschrift + Eintraege) als echtes Raster mit fester
    // Spaltenzahl statt einer ragged Zeilenumbruch-Liste -- dadurch bleiben die Eintraege sauber
    // untereinander ausgerichtet und die Gruppe nimmt insgesamt weniger Platz ein.
    function zeichneLegendeGruppe(titel: string, eintraege: { text: string; chipBreite: number; zeichneMuster: (x: number, y: number) => void }[]) {
      if (eintraege.length === 0) return;
      const maxChipBreite = Math.max(...eintraege.map((e) => e.chipBreite));
      const maxTextBreite = Math.max(...eintraege.map((e) => doc.getTextWidth(e.text)));
      const spaltenBreite = maxChipBreite + 2 + maxTextBreite + 5;
      const nutzbareBreite = doc.internal.pageSize.getWidth() - 2 * SEITENRAND_MM;
      const spalten = Math.max(1, Math.min(8, Math.floor(nutzbareBreite / spaltenBreite)));
      const zeilenAnzahl = Math.ceil(eintraege.length / spalten);
      const zeilenHoehe = 4.3;
      const benoetigteHoehe = 4 + zeilenAnzahl * zeilenHoehe + 2.5;
      if (naechsteStartY + benoetigteHoehe > seitenHoehe - 8) {
        doc.addPage();
        naechsteStartY = 12;
      }
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(21, 50, 95);
      doc.text(titel, SEITENRAND_MM, naechsteStartY);
      doc.setFont("helvetica", "normal");
      naechsteStartY += 4;
      eintraege.forEach((e, i) => {
        const x = SEITENRAND_MM + (i % spalten) * spaltenBreite;
        const y = naechsteStartY + Math.floor(i / spalten) * zeilenHoehe;
        e.zeichneMuster(x, y);
        doc.setFontSize(7.5);
        doc.setTextColor(21, 50, 95);
        doc.text(e.text, x + e.chipBreite + 2, y);
      });
      naechsteStartY += zeilenAnzahl * zeilenHoehe + 2.5;
    }

    if (schichtartenListe.length > 0 || bereitschaftInitialenListe.length > 0) {
      if (naechsteStartY > seitenHoehe - 20) {
        doc.addPage();
        naechsteStartY = 12;
      }
      doc.setFontSize(10);
      doc.setTextColor(21, 50, 95);
      doc.text("Legende", SEITENRAND_MM, naechsteStartY);
      naechsteStartY += 5;

      zeichneLegendeGruppe(
        "Schichtarten",
        schichtartenListe.map((s) => legendeChip(s.kuerzel, s.farbe, s.bezeichnung))
      );
      zeichneLegendeGruppe(
        "Bereitschaften",
        bereitschaftInitialenListe.map((b) => legendeChip(b.initialen, undefined, b.name))
      );
    }

    doc.save(`team-uebersicht-${jahr}-${String(monat).padStart(2, "0")}.pdf`);
  }

  return (
    <div className="page">
      <h1>Team-Übersicht</h1>
      <p className="hint">Veröffentlichte Schichten aller Teams -- eigene Entwürfe eines Teams sind hier bewusst nicht sichtbar.</p>
      <div className="toolbar">
        <button onClick={() => monatWechseln(-1)}>← Vormonat</button>
        <span style={{ minWidth: "10rem", textAlign: "center" }}>{monatLabel}</span>
        <button onClick={() => monatWechseln(1)}>Nächster Monat →</button>
        <button onClick={pdfExportieren}>Als PDF exportieren</button>
      </div>

      {loading && <div className="center-info">Lade…</div>}

      {!loading && bereitschaftsartenListe.length > 0 && (
        <section>
          <h2>Bereitschaften</h2>
          <p className="hint">Bereitschaften gelten teamübergreifend, daher hier gesammelt statt je Team.</p>
          <div className="uebersicht-monat-scroll">
            <table className="table uebersicht-monat">
              <thead>
                <tr>
                  <th>Bereitschaft</th>
                  {tage.map((t) => (
                    <th key={t} className={tagKlasse(t)} title={feiertagNachDatum.get(t)}>
                      <div className="tag-nr">{Number(t.slice(8, 10))}</div>
                      <div className="tag-wt">{wochentagKurz(t)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bereitschaftsartenListe.map((ba) => (
                  <tr key={ba.id}>
                    <td>
                      <span className="badge" style={{ background: ba.farbe, color: kontrastfarbe(ba.farbe) }}>
                        &nbsp;
                      </span>{" "}
                      {ba.bezeichnung}
                    </td>
                    {tage.map((t) => {
                      const namen = bereitschaften.filter((b) => b.bereitschaftsartId === ba.id && b.datum === t).map((b) => b.mitarbeiterName);
                      return (
                        <td key={t} className={tagKlasse(t)}>
                          {/* Initialen statt Name im Klartext -- so bleibt die Spalte so schmal
                              wie in den Team-Tabellen (table-layout: fixed in styles.css), aber
                              wer Bereitschaft hat, ist direkt sichtbar statt nur per Tooltip (der
                              beim PDF-Export ohnehin nicht funktioniert). Vollname zusaetzlich im
                              Tooltip fuer die Bildschirmansicht. */}
                          {namen.length > 0 && (
                            <span className="badge" style={{ background: ba.farbe, color: kontrastfarbe(ba.farbe) }} title={namen.join(", ")}>
                              {namen.map(initialen).join(",")}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading &&
        einheiten.map((pe) => {
          return (
            <section key={pe.id}>
              <h2>
                {pe.name}
                {pe.standort && <span className="hint"> · {pe.standort}</span>}
              </h2>
              {pe.mitarbeiter.length === 0 ? (
                <p className="empty">Keine Mitarbeiter in diesem Team.</p>
              ) : (
                <div className="uebersicht-monat-scroll">
                  <table className="table uebersicht-monat">
                    <thead>
                      <tr>
                        <th>Mitarbeiter</th>
                        {tage.map((t) => (
                          <th key={t} className={tagKlasse(t)} title={feiertagNachDatum.get(t)}>
                            <div className="tag-nr">{Number(t.slice(8, 10))}</div>
                            <div className="tag-wt">{wochentagKurz(t)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pe.mitarbeiter.map((m) => (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          {tage.map((t) => {
                            const treffer = pe.zuweisungen.filter((z) => z.benutzerId === m.id && z.datum === t);
                            return (
                              <td key={t} className={tagKlasse(t)}>
                                {treffer.length > 0 ? (
                                  treffer.map((z) => {
                                    const kommentare = z.kommentare ?? [];
                                    const titel =
                                      `${z.bezeichnung} (${z.ganztags ? "ganztägig" : `${z.beginn}–${z.ende}`})` +
                                      (kommentare.length > 0
                                        ? "\n\n" +
                                          kommentare
                                            .map(
                                              (k) =>
                                                `${k.sichtbarkeit === "nur_planer" ? "[nur Planer] " : ""}${k.autorName}: ${k.text}`
                                            )
                                            .join("\n")
                                        : "");
                                    return (
                                      <span key={z.id} className="badge" style={{ background: z.farbe, color: kontrastfarbe(z.farbe) }} title={titel}>
                                        {z.kuerzel}
                                        {kommentare.length > 0 && <span className="kommentar-marker" />}
                                      </span>
                                    );
                                  })
                                ) : (
                                  (() => {
                                    const freiKommentare = (pe.freischichtKommentare ?? []).filter(
                                      (k) => k.benutzerId === m.id && k.datum === t
                                    );
                                    const titel =
                                      "Freischicht" +
                                      (freiKommentare.length > 0
                                        ? "\n\n" +
                                          freiKommentare
                                            .map((k) => `${k.sichtbarkeit === "nur_planer" ? "[nur Planer] " : ""}${k.autorName}: ${k.text}`)
                                            .join("\n")
                                        : "");
                                    return (
                                      <span className="freischicht-hinweis" title={titel}>
                                        frei
                                        {freiKommentare.length > 0 && <span className="kommentar-marker" />}
                                      </span>
                                    );
                                  })()
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}

      {!loading && (schichtartenListe.length > 0 || bereitschaftInitialenListe.length > 0) && (
        <section>
          <h2>Legende</h2>
          {schichtartenListe.length > 0 && (
            <div className="uebersicht-legende-gruppe">
              <h3>Schichtarten</h3>
              <div className="uebersicht-legende">
                {schichtartenListe.map((s) => (
                  <span key={s.kuerzel} className="uebersicht-legende-eintrag">
                    <span className="badge" style={{ background: s.farbe, color: kontrastfarbe(s.farbe) }}>
                      {s.kuerzel}
                    </span>
                    {s.bezeichnung}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Welche Bereitschaftsart eine Zeile ist, steht schon als Zeilenbeschriftung in der
              Bereitschaften-Tabelle -- hier werden stattdessen die dort verwendeten Initialen
              (siehe initialen()) auf volle Namen aufgeloest, da diese ohne Tooltip/Hover (bzw. im
              PDF-Export) sonst mehrdeutig blieben. */}
          {bereitschaftInitialenListe.length > 0 && (
            <div className="uebersicht-legende-gruppe">
              <h3>Bereitschaften</h3>
              <div className="uebersicht-legende">
                {bereitschaftInitialenListe.map((b) => (
                  <span key={`b${b.benutzerId}`} className="uebersicht-legende-eintrag">
                    <span className="uebersicht-legende-initialen">{b.initialen}</span>
                    {b.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
