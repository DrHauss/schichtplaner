# Konzept: Webbasierte Schichtplanung mit Schichtbörse

**Arbeitstitel:** „SchichtWeb" – Dienstplanung & Schichtbewerbung
**Stand:** 10.07.2026 · Entwurf v0.1

---

## 1. Ausgangslage und Zielsetzung

Die bisherige Schichtplanung erfolgt mit der Windows-Anwendung *Schichtplaner* (RPS Planungssysteme GmbH). Diese deckt die klassische Top-down-Planung ab: Ein Planer weist Mitarbeitern Schichten zu, Urlaub und Abwesenheiten werden verwaltet.

Die neue Webanwendung soll zwei Planungsphilosophien vereinen:

1. **Klassische Dienstplanung (Top-down):** Der Planer erstellt und pflegt Dienstpläne in einer Plantafel und weist Schichten direkt zu.
2. **Schichtbörse mit Bewerbungsverfahren (Bottom-up):** Der Planer schreibt zukünftige Schichten oder **Schichtblöcke** aus (z. B. „Samstag + Sonntag Frühschicht" oder „Nachtschichten Freitag–Sonntag"). Mitarbeiter bewerben sich aktiv auf diese Blöcke. Der Planer vergibt die Blöcke anschließend nach definierten Kriterien.

**Ziele:**

- Plattformunabhängiger Zugriff (Browser, responsiv für Smartphone/Tablet), kein Client-Rollout mehr
- Entlastung der Planer durch Selbstorganisation der Mitarbeiter
- Höhere Mitarbeiterzufriedenheit durch Mitsprache bei der Schichtvergabe
- Transparente, nachvollziehbare und faire Vergabe (Vergabehistorie, Punktesysteme)
- Einhaltung gesetzlicher Vorgaben (Arbeitszeitgesetz, Ruhezeiten) bereits bei der Planung

---

## 2. Zielgruppen und Rollen

| Rolle | Beschreibung | Wesentliche Rechte |
|---|---|---|
| **Administrator** | Systembetreuung | Mandanten-/Benutzerverwaltung, Stammdaten, Konfiguration, Schnittstellen |
| **Planer / Schichtleiter** | Erstellt Dienstpläne und Ausschreibungen | Plantafel bearbeiten, Ausschreibungen anlegen, Bewerbungen sichten und vergeben, Pläne veröffentlichen |
| **Mitarbeiter** | Beschäftigte im Schichtdienst | Eigenen Plan einsehen, sich auf Ausschreibungen bewerben, Verfügbarkeiten und Tauschwünsche pflegen, Abwesenheiten beantragen |
| **Betrachter** (optional) | z. B. Geschäftsleitung, MAV/Betriebsrat | Lesender Zugriff auf veröffentlichte Pläne und Auswertungen |

Rollen werden pro **Planungseinheit** (Team, Abteilung, Standort) vergeben – ein Benutzer kann z. B. in Team A Planer und in Team B Mitarbeiter sein.

---

## 3. Kernfunktionen

### 3.1 Stammdaten

- **Mitarbeiter:** Name, Personalnummer, Kontaktdaten, Beschäftigungsumfang (Wochenstunden / Stellenanteil), Eintritt/Austritt, Qualifikationen
- **Qualifikationen/Skills:** frei definierbar (z. B. Ersthelfer, Staplerschein, Schichtleiterbefähigung); Schichten können Qualifikationen voraussetzen
- **Schichtarten:** Kürzel, Bezeichnung, Farbcode, Beginn/Ende, Pausenregelung, Bewertung in Stunden, Zuschlagsart (Nacht/Sonntag/Feiertag)
- **Planungseinheiten:** Teams/Abteilungen/Standorte mit eigenem Planungskalender und Besetzungsbedarf
- **Besetzungsbedarf:** Soll-Besetzung je Schichtart und Wochentag (z. B. Frühschicht Mo–Fr: 4 Personen, davon 1 Schichtleiter)

### 3.2 Dienstplanung (Plantafel)

- Matrix-Ansicht: Mitarbeiter (Zeilen) × Kalendertage (Spalten), umschaltbar Woche/Monat
- Zuweisung per Klick oder Drag & Drop, Mehrfachauswahl, Kopieren von Wochenmustern und Rotationsplänen
- Live-Anzeige von **Soll/Ist-Besetzung** je Schicht mit Ampellogik (unterbesetzt/ausreichend/überbesetzt)
- **Konfliktprüfung in Echtzeit:** Doppelbelegung, fehlende Qualifikation, Ruhezeitunterschreitung (11 h nach § 5 ArbZG), maximale tägliche/wöchentliche Arbeitszeit, Überschreitung des Stundenkontos
- Planstatus: *Entwurf* → *Veröffentlicht*. Änderungen nach Veröffentlichung werden protokolliert und lösen Benachrichtigungen aus
- Abwesenheitsverwaltung: Urlaub, Krankheit, Fortbildung usw. mit Antrags-/Genehmigungsworkflow und Resturlaubsanzeige

### 3.3 Schichtbörse: Ausschreibung und Bewerbung (Kernstück)

#### Schichtblöcke definieren

Ein **Schichtblock** ist eine vom Planer geschnürte, unteilbare Einheit aus einer oder mehreren Schichten, die nur als Ganzes vergeben wird. Beispiele:

- „Wochenende Frühschicht": Sa 06:00–14:00 + So 06:00–14:00
- „Nachtschicht-Block": Fr, Sa, So jeweils 22:00–06:00
- Einzelschicht: Mi Spätdienst 14:00–22:00

Eigenschaften eines Blocks: Bezeichnung, enthaltene Schichten (Datum + Schichtart), Anzahl benötigter Personen pro Block, erforderliche Qualifikationen, Planungseinheit, ggf. Vergütungs-/Zuschlagshinweis.

#### Ausschreibung (Abfrage)

- Der Planer erstellt eine **Ausschreibungsrunde** mit: Zeitraum (z. B. „Wochenenddienste August 2026"), enthaltenen Blöcken, **Bewerbungsfrist** und Vergabeverfahren
- Optional: Mindest-/Höchstzahl von Blöcken, auf die sich ein Mitarbeiter bewerben muss/darf (z. B. „jeder muss mindestens 2 Wochenenden anbieten")
- Zielgruppensteuerung: Ausschreibung sichtbar für alle Mitarbeiter der Planungseinheit oder nur für bestimmte Qualifikationsgruppen
- Veröffentlichung löst Benachrichtigung aus (E-Mail / Push / In-App)

#### Bewerbung durch Mitarbeiter

- Übersichtliche Listen-/Kalenderansicht aller offenen Blöcke mit Statusanzeige (offen, beworben, vergeben)
- Bewerbung per Klick, optional mit **Priorität** (1. Wunsch, 2. Wunsch, …) und Kommentar
- Automatische Vorprüfung bereits bei der Bewerbung: Kollision mit bestehenden Schichten, Urlaub, Ruhezeiten → Warnung oder Sperre
- Rückzug der Bewerbung bis zum Fristende möglich

#### Vergabe

Der Planer erhält nach Fristablauf eine **Vergabeübersicht** je Block: Bewerberliste mit Priorität, Qualifikationen, aktuellem Stundenkonto und Vergabehistorie. Unterstützte Vergabeverfahren:

1. **Manuell:** Planer entscheidet frei (Standard im MVP)
2. **Fairness-Vorschlag:** System schlägt Vergabe vor, gewichtet nach Kriterien wie „wenigste zugewiesene Wochenenddienste in den letzten X Monaten", Stundenkonto-Ausgleich, Bewerbungspriorität, First-come-first-served
3. **Automatisch** (Ausbaustufe): regelbasierte Vollautomatik mit manueller Freigabe

Nach der Vergabe:

- Zusage/Absage-Benachrichtigung an alle Bewerber
- Vergebene Blöcke werden **automatisch in den Dienstplan übernommen**
- Nicht vergebene Blöcke bleiben als Lücke sichtbar → Planer kann nachfassen, Frist verlängern oder direkt zuweisen
- Vollständige **Vergabehistorie** für Transparenz und ggf. Mitbestimmungsgremien (Betriebsrat/MAV)

#### Ergänzende Selbstorganisation (Ausbaustufe)

- **Schichttausch:** Mitarbeiter bietet zugewiesene Schicht zum Tausch an; Kollegen können übernehmen, Planer genehmigt
- **Verfügbarkeiten/Wunschfrei:** Mitarbeiter hinterlegen wiederkehrende Verfügbarkeiten und Sperrtage als Planungsgrundlage
- **Kurzfristige Springer-Anfragen:** „Wer kann morgen einspringen?" mit Push-Benachrichtigung

### 3.4 Benachrichtigungen

- In-App-Benachrichtigungszentrale, E-Mail, optional Web-Push
- Auslöser: neue Ausschreibung, Fristerinnerung (48 h vor Ende), Zusage/Absage, Planänderung nach Veröffentlichung, Tauschanfrage, Genehmigungsentscheidung

### 3.5 Auswertungen und Export

- Stundenkonto je Mitarbeiter (Soll/Ist, Mehr-/Minderstunden), Zuschlagsstunden (Nacht/Sonntag/Feiertag)
- Besetzungsstatistik, Verteilungsfairness (Wochenend-/Nachtdienste je Mitarbeiter)
- Urlaubskonten
- Exporte: PDF-Dienstplan (Aushang), Excel/CSV, **iCal-Feed** je Mitarbeiter (Abo im privaten Kalender), Schnittstelle zur Lohnabrechnung (CSV/DATEV-Format, Ausbaustufe)

---

## 4. Zentrale Workflows (Übersicht)

**Workflow Ausschreibungsrunde:**

```
Planer legt Blöcke an → Ausschreibung veröffentlichen → Benachrichtigung
→ Mitarbeiter bewerben sich (mit Prioritäten) → Bewerbungsfrist endet
→ Vergabeübersicht + Fairness-Vorschlag → Planer vergibt
→ Zusagen/Absagen → automatische Übernahme in den Dienstplan
→ Restlücken: Nachfassen / Direktzuweisung
```

**Workflow klassische Planung:**

```
Besetzungsbedarf definieren → Plan im Entwurf erstellen (Muster/Rotation)
→ Konfliktprüfung → Veröffentlichen → Änderungen mit Protokoll + Benachrichtigung
```

---

## 5. Datenmodell (vereinfacht)

| Entität | Wichtige Felder | Beziehungen |
|---|---|---|
| `mitarbeiter` | id, name, personalnr, wochenstunden, eintritt, austritt | n:m `qualifikation`, n:m `planungseinheit` (mit Rolle) |
| `qualifikation` | id, bezeichnung | – |
| `planungseinheit` | id, name, standort | – |
| `schichtart` | id, kuerzel, farbe, beginn, ende, pause_min, stundenwert, zuschlagsart | gehört zu `planungseinheit` |
| `besetzungsbedarf` | schichtart_id, wochentag, soll_anzahl, qualifikation_id (optional) | – |
| `schicht_zuweisung` | id, mitarbeiter_id, schichtart_id, datum, status (entwurf/veröffentlicht), quelle (manuell/börse/tausch) | Kern der Plantafel |
| `abwesenheit` | id, mitarbeiter_id, typ, von, bis, status (beantragt/genehmigt/abgelehnt) | – |
| `ausschreibung` | id, titel, planungseinheit_id, bewerbungsfrist, vergabeverfahren, status | 1:n `schichtblock` |
| `schichtblock` | id, ausschreibung_id, bezeichnung, personen_bedarf, qualifikation_id (optional) | 1:n `blockschicht` (datum + schichtart_id) |
| `bewerbung` | id, schichtblock_id, mitarbeiter_id, prioritaet, kommentar, status (offen/zugesagt/abgelehnt/zurückgezogen), zeitstempel | – |
| `vergabe_protokoll` | id, schichtblock_id, mitarbeiter_id, entschieden_von, entschieden_am, begruendung | Auditierbarkeit |
| `benachrichtigung` | id, empfaenger_id, typ, payload, gelesen_am | – |

---

## 6. Technische Architektur

### Vorschlag Technologie-Stack

| Schicht | Empfehlung | Alternative |
|---|---|---|
| **Frontend** | React (oder Vue 3) als SPA, responsiv/Mobile-first; Plantafel als virtualisierte Grid-Komponente | Blazor, falls .NET-lastiges Umfeld |
| **Backend/API** | REST- oder GraphQL-API; Node.js (NestJS) oder .NET 8 (ASP.NET Core) oder Python (FastAPI) | – |
| **Datenbank** | PostgreSQL (relational, gut für Planungs-/Zeitdaten) | MS SQL Server |
| **Auth** | OpenID Connect / OAuth 2.0; Anbindung an **Microsoft Entra ID / Microsoft 365** für Single Sign-on | lokale Konten mit 2FA |
| **Benachrichtigungen** | E-Mail (SMTP/Graph API), Web-Push, In-App über WebSockets/SSE | – |
| **Hosting** | Container (Docker) – Cloud (Azure App Service) oder On-Premises | – |

### Architekturprinzipien

- **Mandantenfähigkeit** von Beginn an (mehrere Organisationen/Standorte in einer Instanz)
- Regelwerk (ArbZG-Prüfungen, Vergabelogik) als eigenständiger, testbarer Service – Regeln konfigurierbar, nicht hartkodiert
- Audit-Log für alle planungsrelevanten Änderungen
- API-first: dieselbe API bedient Web-Frontend, spätere native Apps und Schnittstellen (Lohn, Zeiterfassung)
- Offlinefähige PWA als pragmatischer Weg zur „App" ohne App-Store-Aufwand

---

## 7. Rechtliche und organisatorische Anforderungen

- **Arbeitszeitgesetz (ArbZG):** Ruhezeit 11 h (§ 5), Höchstarbeitszeit (§ 3), Nachtarbeitsregelungen (§ 6), Sonn-/Feiertagsruhe (§§ 9–11) – als Prüfregeln im System, mit dokumentierter Übersteuerungsmöglichkeit durch den Planer
- **Datenschutz:** DSGVO; im kirchlichen Umfeld stattdessen **KDG** beachten (Auftragsverarbeitung nach § 29 KDG, Verzeichnis der Verarbeitungstätigkeiten, Löschkonzept, Hosting-Standort EU)
- **Mitbestimmung:** Dienstpläne und insbesondere Vergabeverfahren sind regelmäßig mitbestimmungspflichtig (BetrVG § 87 bzw. **MAVO § 36** im kirchlichen Bereich) – Gremium früh einbinden; Betrachterrolle und Vergabehistorie unterstützen dies
- **Barrierefreiheit:** WCAG 2.1 AA / BITV 2.0 anstreben
- **Sprache:** zunächst Deutsch, Architektur i18n-fähig

---

## 8. Roadmap / Ausbaustufen

### Stufe 1 – MVP (ca. 3–4 Monate)

- Stammdaten (Mitarbeiter, Schichtarten, Planungseinheiten, Qualifikationen)
- Plantafel mit manueller Zuweisung, Soll/Ist-Besetzung, Basis-Konfliktprüfung
- **Schichtbörse:** Ausschreibung von Blöcken, Bewerbung mit Priorität, manuelle Vergabe, automatische Planübernahme
- Benachrichtigungen per E-Mail und In-App
- Mitarbeiter-Selbstansicht (mein Plan, meine Bewerbungen), PDF-Export, iCal-Feed
- Login mit SSO (Entra ID)

### Stufe 2 – Komfort (3 Monate)

- Abwesenheitsworkflow mit Urlaubskonten
- Fairness-Vorschlag bei der Vergabe, Vergabehistorie/Statistik
- Schichttausch-Workflow, Verfügbarkeiten/Wunschfrei
- Stundenkonten und Zuschlagsauswertung, Excel-Export
- Web-Push, PWA-Installation

### Stufe 3 – Automatisierung & Integration

- Regelbasierte automatische Vergabe mit Freigabe
- Automatische Planvorschläge (Solver auf Basis Bedarf + Verfügbarkeiten)
- Springer-Anfragen in Echtzeit
- Schnittstellen: Lohnabrechnung, Zeiterfassung, ggf. Import aus Schichtplaner 6 (Migration der Bestandsdaten)

---

## 9. Abgrenzung zum bestehenden Schichtplaner (RPS)

| Aspekt | Schichtplaner 6 (Bestand) | Neues Konzept |
|---|---|---|
| Plattform | Windows-Client (+ Apps/Browser-Anmeldung) | Vollständig webbasiert, PWA |
| Planungsansatz | Top-down-Zuweisung | Top-down **und** Bottom-up (Schichtbörse) |
| Schichtblöcke mit Bewerbung | nicht vorhanden | Kernfunktion |
| Vergabetransparenz | – | Vergabehistorie, Fairness-Kennzahlen |
| Mitarbeiter-Selbstorganisation | eingeschränkt | Bewerbung, Tausch, Verfügbarkeiten |

---

## 10. Offene Punkte / nächste Schritte

1. **Zielumgebung klären:** Eigenentwicklung, Auftragsentwicklung oder Prüfung, ob eine Marktlösung (z. B. mit Schichtbörsen-Funktion) den Bedarf bereits deckt
2. Anzahl Mitarbeiter, Planungseinheiten und Planer quantifizieren (Dimensionierung, Lizenz-/Kostenmodell)
3. Vergabekriterien mit den Beteiligten (Leitung, MAV/Betriebsrat, Mitarbeiter) abstimmen und als Regelwerk dokumentieren
4. Klick-Prototyp der Schichtbörse (Ausschreibung → Bewerbung → Vergabe) zur Validierung mit 2–3 Pilotnutzern
5. Datenschutzkonzept und Verfahrensbeschreibung erstellen
6. Migrationskonzept für Bestandsdaten aus Schichtplaner 6 prüfen (Export-Möglichkeiten sichten)
