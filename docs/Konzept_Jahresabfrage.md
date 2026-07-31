# Konzept: Jahresplanung über eine Schichtabfrage

**Ergänzung zu:** „Webbasierte Schichtplanung mit Schichtbörse" (Konzept v0.1)
**Gegenstand:** Planung des kommenden Jahres über eine terminierte Abfrage, auf die sich Mitarbeiter bis zu einer Frist bewerben
**Stand:** 31.07.2026 · Entwurf v0.1

---

## 1. Ausgangslage

Die Dienste für das kommende Jahr werden heute über eine Framadate-/STUdS-Umfrage abgefragt
(Beispiel: `…/frama/studs.php?poll=PPTqmV2ledJcs5pE`). Der Ablauf ist eingespielt und soll
erhalten bleiben:

1. Der Planer legt eine Umfrage mit allen Terminen des Jahres an.
2. Er verschickt **einen Link**. Wer den Link hat, trägt sich ein – ohne Konto, ohne Installation.
3. Jeder trägt pro Termin **Ja / Wenn nötig / Nein** ein und kann seinen Eintrag bis zum Schluss ändern.
4. Alle sehen die Matrix und die Summenzeile – man sieht sofort, wo es eng wird.
5. Nach Fristende wertet der Planer aus und erstellt daraus den Dienstplan.

**Was daran gut funktioniert** (und im Nachfolger nicht verloren gehen darf):

- Kein Login, keine Hürde. Ein Link genügt.
- Alles auf einem Blatt: Personen × Termine als Raster, Summen unten.
- Selbst korrigierbar bis zur Frist.
- Für den Planer trivial anzulegen und zu verstehen.

**Wo es an Grenzen stößt:**

| Problem heute | Auswirkung |
|---|---|
| Termine müssen von Hand in die Umfrage getippt werden | Bei ~100 Terminen im Jahr sehr aufwendig und fehleranfällig |
| Kein Bezug zu Urlaub, Abwesenheiten, Qualifikationen | Zusagen kollidieren mit bereits Bekanntem, Prüfung im Kopf |
| Kein Soll-Bedarf je Termin | „2 Personen pro Dienst" steht nirgends, nur im Kopf des Planers |
| Auswertung manuell (Excel) | Verteilung über das Jahr ist mühsam und schwer zu begründen |
| Kein Übergang in den Plan | Ergebnis muss abgetippt werden; keine Rückmeldung an die Mitarbeiter |
| Keine Erinnerung, kein Nachfassen | Planer hakt einzeln per Mail nach |
| Datenschutz | Alle Namen und Verfügbarkeiten sind für jeden mit Link sichtbar, unbegrenzt haltbar |

**Die Idee dieses Konzepts:** Die Umfrage bleibt genau so, wie die Beteiligten sie kennen –
ein Link, ein Raster, drei Antwortmöglichkeiten. Alles, was drumherum heute Handarbeit ist
(Termine anlegen, auswerten, in den Plan übertragen, nachfassen), übernimmt das System.

---

## 2. Grundidee: die „Jahresabfrage"

Eine **Jahresabfrage** ist eine Ausschreibungsrunde über einen langen Zeitraum (typisch
ein Kalenderjahr), die zwei Oberflächen auf denselben Daten anbietet:

```
                     ┌─────────────────────────────────┐
   Terminserien ───► │        Jahresabfrage            │ ◄─── Bedarf je Termin
   (Generator)       │  Zeitraum 01.01.–31.12.2027     │      (Soll-Besetzung)
                     │  Frist 30.09.2026                │
                     └───────────────┬─────────────────┘
                                     │
                  ┌──────────────────┴──────────────────┐
                  ▼                                     ▼
        Rasteransicht (wie Framadate)          Blockansicht (Schichtbörse)
        Personen × Termine, Ja/Wenn nötig/Nein  Liste mit Details, Bewerbung
        Zugang per Link, auch ohne Login        Zugang für angemeldete Nutzer
                  └──────────────────┬──────────────────┘
                                     ▼
                       Auswertung nach Fristende
                       Vergabevorschlag (Engpass + Fairness)
                                     ▼
                       Übernahme in die Plantafel + Zu-/Absagen
```

Technisch ist eine Jahresabfrage **kein neues Objekt**, sondern die bestehende
`ausschreibung` mit `typ = 'jahresabfrage'`, einem Zeitraum und einem Zugangstoken. Die
Rasteransicht ist eine zweite Darstellung derselben `schichtblock`/`bewerbung`-Daten. Damit
gilt alles, was schon gebaut ist – Konfliktprüfung, Vergabeprotokoll, Planübernahme,
Benachrichtigungen – automatisch auch für die Jahresabfrage.

---

## 3. Die fünf Bausteine

### 3.1 Terminserien-Generator: das Jahr in einem Schritt anlegen

Das größte Hindernis bei Jahresplanung ist das Anlegen von ~100 Terminen. Statt Einzelanlage
definiert der Planer **Serienregeln** und lässt das Jahr erzeugen:

| Regel | Beispiel | Ergebnis |
|---|---|---|
| Wöchentlich | „jeden Samstag, Frühschicht, 2 Personen" | 52 Blöcke |
| Monatlich | „1. Sonntag im Monat" | 12 Blöcke |
| Wochenend-Block | „Sa + So als eine Einheit, nicht teilbar" | 52 Blöcke à 2 Schichten |
| Feiertage | „alle gesetzlichen Feiertage NRW" | aus Feiertagskalender |
| Aus Vorjahr | „Termine 2026 übernehmen, Daten um ein Jahr schieben" | Kopie mit neuen Daten |
| Ausnahmen | „ohne 24.12.–26.12., ohne KW 30–32" | Abzug aus der Serie |

Vorschau vor dem Erzeugen („127 Termine, 254 Plätze"), danach jeder Termin einzeln
editier- oder löschbar. Zusätzlich Import per CSV/ICS für Sonderfälle.

*Warum das zuerst kommt:* Ohne Generator ist Jahresplanung im Werkzeug mühsamer als in
Framadate – und wird nicht angenommen.

### 3.2 Die Rasteransicht: der vertraute Framadate-Ersatz

Kern der Oberfläche ist die Matrix, die jeder kennt:

```
                     Sa      So      Sa      So      Sa      So     …    Summe
                    04.01   05.01   11.01   12.01   18.01   19.01         Ja
  Bedarf              2       2       2       2       2       2
  ─────────────────────────────────────────────────────────────────────────────
  Anna Beispiel      [✓]     [✓]     [—]     [·]     [✓]     [✓]     …    28
  Ben Muster         [·]     [·]     [✓]     [✓]     [✓]     [—]     …    19
  Clara Test         [✓]     [—]     [✓]     [✓]     [·]     [·]     …    22
  Dieter Muster      Urlaub  Urlaub  [✓]     [·]     [✓]     [✓]     …    17
  ─────────────────────────────────────────────────────────────────────────────
  Ja                   2       1       3       2       3       2
  Wenn nötig           0       1       0       0       0       1
  Status              ok      eng!    ok      ok      ok      ok

  [✓] Ja    [—] Wenn nötig    [·] Nein    Urlaub = gesperrt (Abwesenheit hinterlegt)
```

Übernommen von Framadate:

- **Drei Antwortwerte** – Ja / Wenn nötig / Nein. Die mittlere Stufe ist in der Praxis
  wichtig: sie unterscheidet „gerne" von „notfalls" und ist die Grundlage für eine faire
  Auswertung.
- **Summenzeile** unter jeder Spalte, sichtbar für alle.
- **Eintrag jederzeit änderbar** bis zur Frist.
- **Alle sehen alles** (konfigurierbar, siehe 3.3) – der soziale Druck einer sichtbaren
  Lücke ist ein wirksames Planungsinstrument.

Neu gegenüber Framadate:

- **Bedarfszeile und Ampel je Spalte:** unterbesetzt / knapp / ausreichend. Der Planer
  sieht während der laufenden Abfrage, wo er nachfassen muss – nicht erst am Ende.
- **Gesperrte Zellen:** genehmigter Urlaub, Abwesenheit oder fehlende Qualifikation
  erscheinen als gesperrt statt als „Nein" – mit Begründung im Tooltip.
- **Warnung statt stiller Kollision:** eine Zusage, die die 11-h-Ruhezeit verletzt oder mit
  einer bestehenden Zuweisung kollidiert, wird beim Eintragen markiert (`regelwerk.ts` ist
  vorhanden und wird wiederverwendet).
- **Mobil:** bei schmalem Bildschirm keine 100-Spalten-Tabelle, sondern eine Terminliste –
  ein Termin pro Karte mit drei großen Schaltflächen, gruppiert nach Monat. Das Raster
  bleibt am Desktop.
- **Persönliches Kontingent:** oben „Ich möchte im Jahr etwa **10** Dienste übernehmen".
  Damit hat der Planer eine Zielgröße pro Person und muss sie nicht raten.

### 3.3 Teilnahme per Link – auch ohne Login

Die entscheidende Anforderung: es muss weiter reichen, einen Link zu verschicken.

Vorgesehen sind drei Zugangsstufen, je Abfrage wählbar:

| Stufe | Link | Wer trägt ein | Eignung |
|---|---|---|---|
| **A – Offener Link** | ein Link für alle, wie heute | Name wird selbst eingetippt | Ehrenamt, wechselnder Kreis, Übergangsphase |
| **B – Persönlicher Link** | ein Token je Person, per Serienmail | Person steht fest | Standard – kein Login, aber eindeutig |
| **C – Angemeldet** | normaler App-Login/SSO | Konto | Mitarbeiter mit App-Zugang |

Alle drei Stufen schreiben in dieselben Tabellen; Stufe B ist der empfohlene Regelfall,
weil sie die Bequemlichkeit von heute behält und trotzdem eindeutig ist:

- Kein Fremdeintrag unter falschem Namen mehr, kein versehentliches Überschreiben.
- Das System weiß, **wer noch nicht geantwortet hat**, und kann gezielt erinnern.
- Rückmeldungen (Zusage/Absage) gehen an eine bekannte Adresse.
- Ein persönlicher Link kann bei Bedarf zurückgezogen/neu erzeugt werden.

Sichtbarkeit getrennt einstellbar: „alle sehen alle Antworten" (wie heute) oder „nur
Summen sichtbar" oder „nur Planer sieht Namen". Datenschutzrechtlich ist die
Namenssichtbarkeit die heikelste Stelle des heutigen Verfahrens (siehe Kap. 9).

### 3.4 Frist, Erinnerung, Nachfassen

- **Bewerbungsfrist** mit Uhrzeit; danach wird die Abfrage automatisch geschlossen
  (`status = 'geschlossen'`), Einträge sind nur noch lesbar.
- **Automatische Erinnerung** an alle, die noch nicht (vollständig) geantwortet haben:
  14 Tage und 48 Stunden vor Fristende.
- **Fortschrittsanzeige** für den Planer: „14 von 18 haben geantwortet", offene Personen
  namentlich, ein Klick für „alle Ausstehenden erinnern".
- **Fristverlängerung** möglich, mit Benachrichtigung an alle.
- **Teilabgabe zulassen:** wer nur die erste Jahreshälfte überblickt, kann speichern und
  später ergänzen; Termine ohne Angabe zählen als „noch offen", nicht als „Nein".

### 3.5 Auswertung und Vergabe für ein ganzes Jahr

Nach Fristende erzeugt das System einen **Vergabevorschlag** – nicht als Automatik, sondern
als Entwurf, den der Planer Zelle für Zelle überschreiben kann.

Verfahren (deterministisch und damit gegenüber MAV/Team erklärbar):

1. **Harte Regeln zuerst** – ausgeschlossen wird, wer „Nein" gesagt hat, Urlaub hat, die
   Qualifikation nicht mitbringt, doppelt belegt wäre oder die 11-h-Ruhezeit verletzen würde.
2. **Knappste Termine zuerst.** Termine werden nach `Zusagen ÷ offene Plätze` sortiert – wo
   nur zwei Leute können und zwei gebraucht werden, wird zuerst gesetzt, damit diese Personen
   nicht vorher anderweitig verplant sind.
3. **Kandidatenreihenfolge je Termin:**
   1. „Ja" vor „Wenn nötig"
   2. wer relativ zu seinem Wunschkontingent am wenigsten hat (`vergeben ÷ gewünscht`)
   3. wer im **Vorjahr** die wenigsten Wochenend-/Feiertagsdienste hatte
   4. Losentscheid mit **festem, dokumentiertem Zufalls-Seed** (reproduzierbar,
      nachvollziehbar, nicht anfechtbar als Willkür)
4. **Nebenbedingungen:** Mindest-/Höchstzahl Dienste je Person, maximal *n* Dienste pro
   Monat, kein zweites Wochenende in Folge – als konfigurierbare Regeln, keine Hartkodierung.
5. **Ergebnis:** Vorschlagsraster mit farblicher Markierung; unbesetzte Termine als Lücke,
   überbuchte Termine als Hinweis. Jede Änderung des Planers wird mit Begründung im
   `vergabe_protokoll` festgehalten.

**Nach der Freigabe:**

- Alle vergebenen Blöcke werden in die Plantafel übernommen (`quelle = 'boerse'`, zunächst
  `status = 'entwurf'`).
- Jeder Teilnehmer bekommt **eine** zusammenfassende Nachricht mit seinen Terminen des
  Jahres – nicht 30 Einzelmails –, plus iCal-Abo für den privaten Kalender.
- Offene Termine gehen in eine **Nachabfrage**: neue Abfrage, die nur die unbesetzten
  Termine enthält, kürzere Frist, gleicher Mechanismus.

---

## 4. Jahreszyklus

```
  Aug 2026   Planer legt Jahresabfrage 2027 an (Serien-Generator, Bedarf, Frist)
             ├─ Vorschau, Termine korrigieren
             └─ Veröffentlichen → Serienmail mit persönlichem Link
  Sep 2026   Mitarbeiter tragen ein (Raster/Mobil), Änderung jederzeit möglich
             ├─ 16.09. automatische Erinnerung an Ausstehende
             └─ 28.09. zweite Erinnerung (48 h)
  30.09.2026 Frist – Abfrage schließt automatisch
  Okt 2026   Auswertung: Vergabevorschlag → Planer prüft und ändert → Freigabe
             ├─ Übernahme in die Plantafel (Entwurf)
             └─ Nachabfrage für unbesetzte Termine (Frist 2 Wochen)
  Nov 2026   Plan 2027 veröffentlichen → Benachrichtigung + iCal
  ab Jan     Laufender Betrieb: Tausch, Springer, Einzelausschreibungen für Änderungen
```

Für sehr lange Zeiträume empfehlenswert: **Jahresraster + Quartalsfeinschliff.** Die
Jahresabfrage klärt die grobe Verfügbarkeit; drei bis vier Wochen vor jedem Quartal
bestätigt eine kurze Abfrage die Termine des Quartals (Urlaub, Änderungen). Das hält die
Jahresplanung verbindlich, ohne im Januar über den November entscheiden zu müssen.

---

## 5. Datenmodell-Erweiterungen

Aufsetzend auf `backend/src/lib/db.ts`; bestehende Tabellen bleiben abwärtskompatibel.

```sql
-- Ausschreibung wird zur Jahresabfrage erweitert
ALTER TABLE ausschreibung ADD COLUMN typ TEXT NOT NULL DEFAULT 'runde';
      -- 'runde' (Bestand) | 'jahresabfrage' | 'nachabfrage'
ALTER TABLE ausschreibung ADD COLUMN zeitraum_von TEXT;
ALTER TABLE ausschreibung ADD COLUMN zeitraum_bis TEXT;
ALTER TABLE ausschreibung ADD COLUMN antwort_modus TEXT NOT NULL DEFAULT 'ja_nein';
      -- 'ja_nein' | 'ja_wennnoetig_nein' (Framadate-Verhalten) | 'prioritaet'
ALTER TABLE ausschreibung ADD COLUMN sichtbarkeit TEXT NOT NULL DEFAULT 'alle';
      -- 'alle' (jeder sieht jede Antwort) | 'summen' | 'nur_planer'
ALTER TABLE ausschreibung ADD COLUMN zugang TEXT NOT NULL DEFAULT 'login';
      -- 'login' | 'link_persoenlich' | 'link_offen'
ALTER TABLE ausschreibung ADD COLUMN token TEXT UNIQUE;          -- offener Link
ALTER TABLE ausschreibung ADD COLUMN nachfolger_von INTEGER;     -- Nachabfrage → Original
ALTER TABLE ausschreibung ADD COLUMN loeschen_am TEXT;           -- Löschkonzept, s. Kap. 9

-- Antwortwert je Zelle (bisher implizit „beworben = ja")
ALTER TABLE bewerbung ADD COLUMN antwort TEXT NOT NULL DEFAULT 'ja';
      -- 'ja' | 'wenn_noetig' | 'nein'
ALTER TABLE bewerbung ADD COLUMN teilnehmer_id INTEGER;  -- für Zugang ohne Konto
ALTER TABLE bewerbung ADD COLUMN geaendert_am TEXT;

-- Teilnehmerkreis einer Abfrage: entkoppelt „wer ist eingeladen" von „wer hat ein Konto"
CREATE TABLE abfrage_teilnehmer (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  benutzer_id      INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,  -- NULL = ohne Konto
  name             TEXT NOT NULL,
  email            TEXT,
  token            TEXT UNIQUE,          -- persönlicher Link
  wunsch_anzahl    INTEGER,              -- gewünschte Dienste im Zeitraum
  eingeladen_am    TEXT,
  erinnert_am      TEXT,
  abgegeben_am     TEXT,
  UNIQUE(ausschreibung_id, name)
);

-- Serienregeln für den Termingenerator (reproduzierbar, nachträglich anpassbar)
CREATE TABLE terminserie (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibung(id) ON DELETE CASCADE,
  bezeichnung      TEXT NOT NULL,
  regel            TEXT NOT NULL,        -- JSON: {typ:'woechentlich', wochentage:[5,6], …}
  schichtart_ids   TEXT NOT NULL,        -- JSON-Array
  personen_bedarf  INTEGER NOT NULL DEFAULT 1,
  qualifikation_id INTEGER REFERENCES qualifikation(id),
  ausnahmen        TEXT                  -- JSON-Array von Daten/Zeiträumen
);

-- Herkunft eines Blocks (für „Serie nachträglich ändern")
ALTER TABLE schichtblock ADD COLUMN terminserie_id INTEGER REFERENCES terminserie(id);
ALTER TABLE schichtblock ADD COLUMN datum_sort TEXT;  -- erstes Datum, für Rasterspalten
```

Bewusst **nicht** neu modelliert: Blöcke, Bewerbungen, Vergabe, Protokoll,
Benachrichtigungen. Die Jahresabfrage ist eine andere Sicht auf denselben Bestand – das
hält die Auswertung, die Planübernahme und die Konfliktprüfung an einer Stelle.

---

## 6. API-Entwurf

```
# Anlegen und Befüllen (Planer)
POST   /api/planungseinheiten/:id/jahresabfragen           Abfrage anlegen (Zeitraum, Frist, Modus)
POST   /api/ausschreibungen/:id/terminserien               Serienregel anlegen
POST   /api/ausschreibungen/:id/terminserien/:sid/vorschau Termine berechnen, noch nicht speichern
POST   /api/ausschreibungen/:id/terminserien/:sid/erzeugen Blöcke erzeugen
POST   /api/ausschreibungen/:id/teilnehmer                 Teilnehmerkreis setzen (+Token erzeugen)
POST   /api/ausschreibungen/:id/einladen                   Serienmail mit persönlichen Links
POST   /api/ausschreibungen/:id/erinnern                   Ausstehende erinnern

# Rasteransicht (alle Rollen)
GET    /api/ausschreibungen/:id/raster                     Spalten, Zeilen, Zellen, Summen, Bedarf
PUT    /api/ausschreibungen/:id/antworten                  Mehrere Zellen auf einmal speichern
                                                           → Antwort enthält Konfliktwarnungen

# Zugang ohne Login (Token im Pfad, kein JWT)
GET    /api/abfrage/:token                                 Raster für diesen Teilnehmer
PUT    /api/abfrage/:token/antworten                       Eigene Zeile speichern

# Auswertung und Vergabe (Planer)
GET    /api/ausschreibungen/:id/auswertung                 Kennzahlen, Engpässe, Antwortquote
POST   /api/ausschreibungen/:id/vergabevorschlag           Vorschlag berechnen (Seed im Ergebnis)
POST   /api/ausschreibungen/:id/vergabe                    Freigeben → Planübernahme + Nachrichten
POST   /api/ausschreibungen/:id/nachabfrage                Offene Termine in neue Abfrage

# Import / Export
POST   /api/ausschreibungen/:id/import/framadate           CSV-Export einer Framadate-Umfrage
GET    /api/ausschreibungen/:id/export.csv                 Raster als CSV
GET    /api/ausschreibungen/:id/export.ics                 Termine als Kalender
```

Der Token-Pfad ist bewusst von der übrigen API getrennt: eigener Router, kein `requireAuth`,
strenges Rate-Limit, nur Lesen/Schreiben der eigenen Zeile.

---

## 7. Framadate-Kompatibilität und Übergang

Der Umstieg soll ohne Bruch möglich sein:

1. **Import einer bestehenden Umfrage.** Framadate/STUdS exportiert CSV (Spalten = Termine,
   Zeilen = Personen, Werte Ja/Wenn nötig/Nein). Der Import liest diese Datei und legt daraus
   Termine, Teilnehmer und Antworten an. Damit lässt sich die laufende Abfrage 2027
   übernehmen, statt sie neu zu erheben.
2. **Übergangsjahr im Parallelbetrieb.** Wer will, füllt weiter die gewohnte Umfrage aus;
   der Planer importiert am Ende. Wer mag, nutzt direkt den neuen Link. Ergebnis ist
   dasselbe Raster.
3. **Export in beide Richtungen** – CSV für Excel, ICS für Kalender, PDF-Aushang.
4. **Wortgleiche Oberfläche.** Bezeichnungen und Symbolik der Antwortwerte werden aus der
   bisherigen Umfrage übernommen („Ja" / „Wenn nötig" / „Nein"), damit niemand umlernen muss.

---

## 8. Oberfläche – was neu gebaut wird

| Ansicht | Nutzer | Inhalt |
|---|---|---|
| **Abfrage anlegen** | Planer | Zeitraum, Frist, Antwortmodus, Sichtbarkeit, Zugangsart |
| **Termingenerator** | Planer | Serienregeln, Ausnahmen, Vorschau, Erzeugen |
| **Teilnehmerkreis** | Planer | Personen wählen/ergänzen, Links erzeugen, einladen |
| **Raster (Desktop)** | alle | Matrix mit fixierter Namensspalte und fixiertem Kopf, Summen, Ampel |
| **Terminliste (Mobil)** | alle | Karte je Termin, drei große Schaltflächen, Monatsgruppen |
| **Fortschritt** | Planer | Antwortquote, Ausstehende, Engpasstermine, Erinnern |
| **Vergabe** | Planer | Vorschlagsraster, Änderung je Zelle, Begründung, Freigabe |
| **Meine Dienste** | Mitarbeiter | Jahresübersicht nach Freigabe, iCal-Abo |

Bestehende Seiten (`SchichtboersePage`, `AusschreibungDetailPage`, `PlantafelPage`) bleiben
unverändert nutzbar; die Rasteransicht kommt als zusätzlicher Reiter der Ausschreibung.

---

## 9. Rechtliche Hinweise

- **Sichtbarkeit personenbezogener Verfügbarkeiten.** Der offene Link macht heute Namen und
  Verfügbarkeiten für jeden Linkinhaber sichtbar – auch für Unbeteiligte, die den Link
  weiterleiten. Empfehlung: Standard auf persönliche Links (Stufe B) mit „alle sehen alle
  Antworten" **innerhalb des Teilnehmerkreises**; der offene Link bleibt nur als bewusst zu
  wählende Ausnahme.
- **Löschkonzept.** Abfragen tragen `loeschen_am` (Vorschlag: 12 Monate nach Ende des
  Planungszeitraums). Danach werden Antworten und Token gelöscht, das Vergabeprotokoll bleibt
  in aggregierter Form für die Fairness-Kennzahlen erhalten.
- **Mitbestimmung.** Das Vergabeverfahren – Reihenfolgekriterien, Kontingente, Losverfahren
  mit dokumentiertem Seed – ist mit MAV/Betriebsrat abzustimmen (MAVO § 36 bzw. BetrVG § 87)
  und wird in der Anwendung als lesbarer Regeltext hinterlegt.
- **KDG/DSGVO.** Token-Links sind Zugangsdaten: nicht in Protokolle schreiben, per HTTPS
  ausliefern, Verzeichnis der Verarbeitungstätigkeiten ergänzen.

---

## 10. Umsetzungsschritte

| Schritt | Inhalt | Nutzen nach diesem Schritt |
|---|---|---|
| **1** | Datenmodell-Erweiterung, Jahresabfrage als Typ, Antwortwert `ja/wenn_noetig/nein` | Fundament |
| **2** | **Rasteransicht** mit Summen, Bedarfszeile, Ampel, Speichern der eigenen Zeile | Framadate ist ersetzbar |
| **3** | **Token-Zugang** (persönlich + offen), Einladungsmail | Der gewohnte Link funktioniert |
| **4** | **Termingenerator** mit Serien, Ausnahmen, Vorschau | Jahr in Minuten statt Stunden |
| **5** | Frist-Automatik, Erinnerungen, Fortschrittsanzeige | Kein manuelles Nachfassen |
| **6** | Vergabevorschlag (Engpass + Fairness + Kontingente), Freigabe, Planübernahme | Auswertung ohne Excel |
| **7** | Nachabfrage, CSV/ICS-Import und -Export, Mobilansicht, PDF-Aushang | Runder Jahreszyklus |

Die Schritte 2 und 3 zusammen ergeben bereits einen vollwertigen Framadate-Ersatz – sinnvoll
als erstes vorzeigbares Ergebnis für zwei bis drei Pilotnutzer.

---

## 11. Offene Entscheidungen

1. **Zugangsart:** persönliche Links als Standard (empfohlen) oder weiterhin ein offener
   Link für alle?
2. **Sichtbarkeit:** sollen wie bisher alle jede Antwort sehen, oder nur die Summen?
3. **Zuschnitt der Termine:** Einzelschichten oder feste Wochenendblöcke (Sa+So gemeinsam)?
4. **Kontingente:** gibt es eine Ober-/Untergrenze an Diensten pro Person und Jahr, und wer
   legt sie fest – Planer oder Mitarbeiter („Wunschanzahl")?
5. **Vergabekriterien und ihre Reihenfolge** – abzustimmen mit dem Team und der
   Mitarbeitervertretung.
6. **Zeitraum:** volles Kalenderjahr in einer Abfrage, oder Jahresraster mit
   Quartalsbestätigung?
7. **Bestandsdaten:** soll die laufende Framadate-Umfrage importiert werden?
