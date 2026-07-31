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

## Konzepte

- [`docs/Konzept_Webbasierte_Schichtplanung.md`](docs/Konzept_Webbasierte_Schichtplanung.md) – Gesamtkonzept (Grundlage des MVP)
- [`docs/Konzept_Jahresabfrage.md`](docs/Konzept_Jahresabfrage.md) – Jahresplanung über eine Schichtabfrage: Ablösung der bisherigen Framadate-/STUdS-Umfrage durch Rasteransicht, Zugang per Link ohne Login, Termingenerator und Vergabevorschlag

Nicht enthaltene Ausbaustufen (siehe Konzept Kap. 8): Schichttausch, Verfügbarkeiten/Wunschfrei, automatische Vergabe, Stundenkonten/Zuschlagsauswertung, Web-Push, PWA, Lohn-/Zeiterfassungs-Schnittstellen.

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

## Datenmodell

Die SQLite-Tabellen in `backend/src/lib/db.ts` setzen das vereinfachte Datenmodell aus Konzept-Kapitel 5 direkt um (`mitarbeiter` → `benutzer`, `schicht_zuweisung`, `ausschreibung`, `schichtblock`, `blockschicht`, `bewerbung`, `vergabe_protokoll`, `benachrichtigung` usw.).

## Regelwerk

ArbZG-Prüfungen (Ruhezeit, Doppelbelegung) sind als eigenständiges, testbares Modul in `backend/src/lib/regelwerk.ts` implementiert und sowohl in der Plantafel-Zuweisung als auch bei der Bewerbung in der Schichtbörse eingebunden – wie in Kapitel 6 des Konzepts gefordert.
