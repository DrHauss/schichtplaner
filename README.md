# SchichtWeb – Dienstplanung & Schichtbörse

Webbasierte Schichtplanungsumgebung gemäß dem Konzept „Webbasierte Schichtplanung mit Schichtbörse" (Stand 10.07.2026). Dieses Repository enthält den MVP (Stufe 1 der Roadmap): Stammdaten, klassische Plantafel mit Konfliktprüfung sowie die Schichtbörse (Ausschreibung → Bewerbung → Vergabe → automatische Planübernahme).

## Aufbau

- `backend/` – REST-API (Node.js, Express, TypeScript, SQLite via `better-sqlite3`)
- `frontend/` – Single-Page-App (React, TypeScript, Vite)

## Umgesetzte Kernfunktionen (Stufe 1 – MVP)

- **Stammdaten:** Planungseinheiten, Mitgliedschaften/Rollen (Planer, Mitarbeiter, Betrachter), Schichtarten, Besetzungsbedarf, Qualifikationen, Abwesenheiten
- **Plantafel:** Matrix-Ansicht Mitarbeiter × Tage, Zuweisung per Klick, Konfliktprüfung in Echtzeit (Doppelbelegung, 11h-Ruhezeit nach § 5 ArbZG), Planstatus Entwurf/Veröffentlicht mit Benachrichtigung
- **Schichtbörse:** Ausschreibungsrunden mit Bewerbungsfrist, Schichtblöcke (mehrere Schichten als unteilbare Einheit), Bewerbung mit Priorität und automatischer Konfliktwarnung, Vergabeübersicht mit Fairness-Vorschlag (wenigste Vergaben in 90 Tagen zuerst), Vergabe mit automatischer Übernahme in den Dienstplan und Absage an übrige Bewerber, vollständige Vergabehistorie (`vergabe_protokoll`)
- **Benachrichtigungen:** In-App-Benachrichtigungszentrale (neue Ausschreibung, Zusage/Absage, Planveröffentlichung)
- **Mitarbeiter-Selbstansicht:** „Mein Plan" mit veröffentlichten Schichten, iCal-Export (`/api/mein/plan.ics`)
- **Auth:** E-Mail/Passwort mit JWT (Platzhalter für spätere SSO-Anbindung an Microsoft Entra ID)

## Jahresabfrage (Konzept-Ergänzung, Ablösung der Framadate-/STUdS-Umfrage)

Umsetzung von [`docs/Konzept_Jahresabfrage.md`](docs/Konzept_Jahresabfrage.md), Kap. 3 (`backend/src/routes/jahresabfrage.ts`, `abfrage.ts`, `frontend/src/pages/JahresabfragePage.tsx`, `AbfrageTokenPage.tsx`):

- **Termingenerator:** Serienregeln (wöchentlich, monatlich per n-tem Wochentag, gesetzliche Feiertage NRW inkl. beweglicher Feiertage, Einzeltermine) erzeugen mit Vorschau die Termine eines Jahres; Gruppierung zu Wochenend-Blöcken statt Einzelschichten möglich (`backend/src/lib/terminserie.ts`, `feiertage.ts`)
- **Rasteransicht:** Personen × Termine mit Ja/Wenn nötig/Nein, Bedarfszeile und Ampel je Termin, gesperrte Zellen bei genehmigter Abwesenheit; eigene Antworten zusätzlich als Terminliste mit drei großen Schaltflächen (Mobil-/Teilnehmeransicht)
- **Zugang per Link ohne Login:** persönliches Token je Teilnehmer, eigener unauthentifizierter Router mit Rate-Limit (`/api/abfrage/:token`, Seite `/abfrage/:token`)
- **Frist-Automatik:** automatisches Schließen nach Ablauf, automatische Erinnerung 14 Tage und 48 h vor Fristende, Fortschrittsanzeige mit Engpass-Ampel je Termin (`backend/src/lib/scheduler.ts`)
- **Vergabevorschlag:** knappste Termine zuerst, „Ja" vor „Wenn nötig", Ausgleich über Wunschanzahl und Vorjahreshistorie, reproduzierbarer seed-basierter Tie-Break statt Zufall; Übernahme läuft über den bestehenden Vergabe-Endpunkt der Schichtbörse
- CSV-Export des Rasters

## Konzepte

- [`docs/Konzept_Webbasierte_Schichtplanung.md`](docs/Konzept_Webbasierte_Schichtplanung.md) – Gesamtkonzept (Grundlage des MVP)
- [`docs/Konzept_Jahresabfrage.md`](docs/Konzept_Jahresabfrage.md) – Jahresplanung über eine Schichtabfrage

Nicht enthaltene Ausbaustufen (siehe Konzept Kap. 8 bzw. Konzept Jahresabfrage Kap. 10): Schichttausch, Verfügbarkeiten/Wunschfrei, vollautomatische Vergabe ohne Freigabe, Stundenkonten/Zuschlagsauswertung, Web-Push, PWA, Lohn-/Zeiterfassungs-Schnittstellen, Framadate-CSV-Import und Nachabfrage.

## Lokale Entwicklung

Voraussetzung: Node.js ≥ 20.

```bash
# Backend
cd backend
npm install
npm run seed   # Demo-Daten anlegen
npm run dev    # API auf http://localhost:4000

# Frontend (separates Terminal)
cd frontend
npm install
npm run dev    # SPA auf http://localhost:5173 (Proxy auf /api -> Backend)
```

### Demo-Zugänge (nach `npm run seed`)

| Rolle | E-Mail | Passwort |
|---|---|---|
| Administrator | admin@schichtweb.de | admin123 |
| Planer | planer@schichtweb.de | planer123 |
| Mitarbeiter | anna@schichtweb.de / ben@schichtweb.de / clara@schichtweb.de | test1234 |

## Produktivbetrieb mit Docker Compose

Voraussetzung: Docker (mit Compose-Plugin) auf dem Zielserver. Das Setup baut zwei Images:

- `backend` – Node/Express-API, kompiliert im Build-Schritt (`node:20-bookworm-slim`, damit die
  nativen `better-sqlite3`-Bindings glibc-kompatibel sind), läuft im Runtime-Image ohne
  Compiler-Werkzeuge. Die SQLite-Datenbank liegt in einem benannten Docker-Volume (`schichtweb-data`)
  unter `/app/data` und übersteht damit Neustarts/Deploys.
- `frontend` – statischer Vite-Produktionsbuild, ausgeliefert über nginx; `nginx.conf` leitet
  `/api/*` intern an den `backend`-Dienst weiter und liefert für alle anderen Pfade `index.html`
  aus (SPA-Routing).

```bash
cp .env.example .env
# JWT_SECRET setzen -- z. B.:
sed -i "s/^JWT_SECRET=$/JWT_SECRET=$(openssl rand -hex 32)/" .env
# Optional: CORS_ORIGIN auf die tatsächliche Frontend-Domain setzen, HTTP_PORT anpassen.

docker compose up -d --build
```

Das Frontend ist danach unter `http://<server>:${HTTP_PORT:-80}/` erreichbar (dahinter i. d. R.
noch ein Reverse Proxy mit TLS-Terminierung, z. B. nginx/Caddy/Traefik auf dem Host).

`npm run seed` legt bewusst nur Demo-/Testdaten mit öffentlich bekannten Passwörtern an und ist
**nicht** für den Produktivbetrieb gedacht. Stattdessen den ersten echten Administrator anlegen:

```bash
docker compose exec backend node dist/lib/create-admin.js admin@firma.de "Max Mustermann" "ein-starkes-passwort"
```

Weitere Planungseinheiten, Mitarbeiter und Schichtarten lassen sich danach über die Oberfläche
(Stammdaten, als Administrator angemeldet) anlegen.

### Backup

Die SQLite-Datei ist die einzige Datenhaltung der Anwendung. Eine konsistente Kopie (auch bei
laufendem Betrieb, WAL-sicher) erzeugt:

```bash
docker compose exec backend node dist/lib/backup.js
```

Die Kopie landet als `backup-<Zeitstempel>.sqlite` im selben Datenvolume und sollte anschließend
an einen anderen Ort kopiert werden, z. B.:

```bash
docker compose cp backend:/app/data/backup-2026-08-05T12-00-00-000Z.sqlite ./
```

Für regelmäßige Backups einen Cronjob auf dem Host einrichten, der beide Befehle nacheinander
ausführt.

## Datenmodell

Die SQLite-Tabellen in `backend/src/lib/db.ts` setzen das vereinfachte Datenmodell aus Konzept-Kapitel 5 direkt um (`mitarbeiter` → `benutzer`, `schicht_zuweisung`, `ausschreibung`, `schichtblock`, `blockschicht`, `bewerbung`, `vergabe_protokoll`, `benachrichtigung` usw.). Die Jahresabfrage erweitert `ausschreibung`/`bewerbung` um wenige Spalten (`typ`, `zeitraum_von/bis`, `antwort`, …) statt neue Kernobjekte einzuführen und ergänzt `terminserie` sowie `abfrage_teilnehmer`.

## Regelwerk

ArbZG-Prüfungen (Ruhezeit, Doppelbelegung) sind als eigenständiges, testbares Modul in `backend/src/lib/regelwerk.ts` implementiert und sowohl in der Plantafel-Zuweisung als auch bei der Bewerbung in der Schichtbörse eingebunden – wie in Kapitel 6 des Konzepts gefordert.
