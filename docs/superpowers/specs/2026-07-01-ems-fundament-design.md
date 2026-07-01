# Faustball EMS — Teilprojekt 1: Fundament

**Datum:** 2026-07-01
**Status:** approved (Design), pending spec review

## Kontext

Ausgangspunkt ist eine PRD für ein vollständiges "Faustball Event Management
System" (Schedule-Generator, digitale Sumula/Live-Scoring, Schiedsrichter-
Verwaltung, automatisierte Tabellen), das den aktuellen Google-Sheets-basierten
Prozess ablösen soll. Die PRD wurde aus der Analyse des bestehenden Sheets
abgeleitet.

Das bestehende Repo `fistball-live` ist eine reine, statische Frontend-PWA
(kein Backend, keine DB), die aus einem öffentlich freigegebenen Google Sheet
liest und Turnier-Standings/Ergebnisse für Zuschauer:innen anzeigt (siehe
`README.md`). Die PRD beschreibt demgegenüber ein komplettes
Dateneingabe-/Verwaltungssystem mit eigenem Backend — im Kern eine neue
Anwendung, keine Erweiterung der bestehenden.

**Zeitdruck:** Zielevent ist die U18 WC & Women's EC in Reiden (23.–26. Juli
2026). Zum Zeitpunkt dieser Spec (1. Juli 2026) bleiben **3 Wochen**. Das
komplette EMS in dieser Zeit zu bauen ist ambitioniert; die PRD wurde daher in
unabhängig spezifizierbare Teilprojekte zerlegt (siehe unten).

## Zerlegung der Gesamt-PRD

1. **Fundament** (diese Spec) — Datenmodell, Backend, Admin-CRUD für
   Stammdaten.
2. **Digitale Sumula (Live-Scoring)** — Punkt-für-Punkt-Erfassung, Satz-/
   Regel-Logik, höchster operativer Nutzen und höchstes Risiko.
3. **Spielplan-Generator** — automatische Match-Erstellung; im Fundament nur
   manuell/per Import abgedeckt, Generator-Logik folgt separat.
4. **Schiedsrichter-Zuweisung** — Zuordnung + Workload-Übersicht.
5. **Standings/Dashboard** — kann die bestehende Tiebreaker-Logik aus
   `app.js` weitgehend wiederverwenden statt sie neu zu bauen.

Jedes Teilprojekt bekommt seine eigene Spec → Plan → Umsetzung. Diese Spec
deckt **ausschließlich Teilprojekt 1** ab.

## Ziel dieses Teilprojekts

Ein Supabase-Backend mit vollständigem Datenmodell für das gesamte EMS
(inkl. der Tabellen, die erst spätere Teilprojekte befüllen), plus eine
schlanke Admin-Oberfläche, mit der die Turnierleitung Turniere, Kategorien,
Teams, Courts und Matches verwalten kann — als direkter Ersatz für die
manuelle Pflege des Google Sheets.

## Architektur

- **Backend:** Supabase-Projekt (Postgres + Auth + Realtime). Kein eigener
  Server, kein eigenes Hosting/Ops.
- **Kosten:** Free-Tier deckt die Datenmengen eines einzelnen Turniers
  vollständig ab (siehe Kostentabelle unten). Free-Projekte pausieren nach 1
  Woche Inaktivität — Empfehlung: in der letzten Woche vor dem Turnier auf
  Pro ($25/Monat, monatlich kündbar) upgraden, danach zurückstufen oder für
  künftige Turniere behalten. Erwartete Gesamtkosten: $0–25.
- **Admin-App:** neues Verzeichnis `/admin` im selben Repo wie
  `fistball-live`. Vanilla JS/HTML/CSS ohne Build-Step (gleicher Stil wie das
  bestehende `app.js`), Supabase-JS-Client per CDN. Kein Framework, kein
  Bundler.
- **Repo-Struktur:** ein Repo, ein Deploy-Ziel, gemeinsame Supabase-Config.
  `fistball-live` bleibt vorerst die öffentliche Lese-Ansicht auf Basis des
  Google Sheets; ob sie später direkt von Supabase liest, wird in Teilprojekt
  5 (Standings/Dashboard) entschieden — nicht Teil dieser Spec.
- **Spätere Teilprojekte** (Sumula, Referee-Zuweisung) nutzen dasselbe
  Supabase-Schema und bekommen eigene Bereiche innerhalb der Admin-App.

### Supabase-Kostentabelle (Referenz)

| Ressource | Free-Limit | Erwarteter Bedarf |
|---|---|---|
| Datenbank | 500 MB | wenige MB |
| Egress | 5 GB/Monat | gering |
| Realtime-Verbindungen | 200 gleichzeitig | Scorer-Tablets + Admin-Clients, weit darunter |
| MAU (Auth) | 50.000 | irrelevant (geteilte Logins) |

## Datenmodell

Vollständiges Schema für das gesamte EMS (auch Tabellen, die erst in
späteren Teilprojekten UI/Schreibzugriff bekommen), damit spätere
Teilprojekte keine Schema-Migrationen mit Breaking Changes brauchen:

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `tournaments` | Ein Turnier | `name`, `start_date`, `end_date`, `config` (jsonb: Scoring-/Tiebreaker-Regeln, analog zum bestehenden `Config`-Tab in der Sheet-Lösung) |
| `categories` | Kategorie/Division innerhalb eines Turniers (z. B. U18 M Gold, WEC) | `tournament_id`, `name`, `format` (round robin / knockout), `best_of` |
| `teams` | Team innerhalb einer Kategorie | `category_id`, `name` (Kein Spieler-Kader in Phase 1 — bewusst zurückgestellt) |
| `courts` | Spielfeld | `tournament_id`, `name`/`number` |
| `matches` | Eine Begegnung | `category_id`, `team_a_id`, `team_b_id`, `court_id`, `scheduled_time`, `status` (`scheduled`/`live`/`finished`), `round_label` |
| `sets` | Satz innerhalb eines Matches (Schema jetzt, UI erst Teilprojekt 2) | `match_id`, `set_number`, `points_a`, `points_b`, `winner_team_id` |
| `point_events` | Einzelereignis innerhalb eines Satzes (Schema jetzt, UI erst Teilprojekt 2) | `set_id`, `event_type`, `team_id`, `created_at` |
| `referee_assignments` | Zuordnung Schiedsrichter ↔ Match (Schema jetzt, UI erst Teilprojekt 4) | `match_id`, `referee_name`, `role` (1st/2nd/linesman) |
| `user_roles` | Rollenzuordnung für die zwei geteilten Logins | `user_id`, `role` (`admin`/`scorer`) |

Referentielle Integrität über Foreign Keys (z. B. `matches.team_a_id →
teams.id`); Löschen von referenzierten Teams/Courts wird dadurch verhindert.

## Zugriffskontrolle

Zwei geteilte Logins (kein individuelles Account-System), gemappt über
`user_roles`:

- **Admin:** volles CRUD auf `tournaments`, `categories`, `teams`, `courts`,
  `matches`, `referee_assignments`. Einzige Rolle, die ein Match auf
  `status = finished` setzen darf — das ist die Kontrollinstanz, bevor ein
  Ergebnis final in die Tabelle einfließt.
- **Scorer:** darf `sets` und `point_events` schreiben sowie ein Match von
  `scheduled` auf `live` setzen. Kein Zugriff auf Stammdaten, kein
  `finished`-Übergang.
- **`anon` (nicht eingeloggt):** nur lesend, für die spätere öffentliche
  Zuschauer-Ansicht.
- Umsetzung über Supabase-Auth (zwei feste User) + RLS-Policies, die die
  Rolle aus `user_roles` prüfen.

Das Scorer-Login und seine UI werden erst in Teilprojekt 2 (Sumula) gebaut;
Rollen und RLS-Policies werden aber bereits jetzt vollständig anlegt, um
spätere Policy-Änderungen zu vermeiden.

## Admin-CRUD-UI-Scope (Teilprojekt 1)

1. **Login** — gemeinsamer Admin-Login.
2. **Turnier** — ein aktives Turnier fürs Juli-Event; Anlegen/Bearbeiten
   (Name, Datum, Scoring-Config).
3. **Kategorien** — Liste + Anlegen/Bearbeiten pro Turnier.
4. **Teams** — Liste + Anlegen/Bearbeiten/Löschen pro Kategorie.
5. **Courts** — Liste + Anlegen/Bearbeiten pro Turnier.
6. **Matches** — Liste (filterbar nach Kategorie/Court/Status) +
   Anlegen/Bearbeiten (Team A/B, Court, Zeit, Rundenbezeichnung); Status
   manuell setzbar unter der oben beschriebenen `finished`-Einschränkung.

**CSV/Sheet-Import:** Die Daten für das Juli-Turnier existieren bereits im
Google Sheet (Matches 16–48 laut bestehendem README). Statt manueller
Neuerfassung: ein einmaliges Import-Tool, das die bestehende Parsing-Logik
aus `app.js` wiederverwendet, um Teams, Courts und Matches zu befüllen. Die
manuellen Formulare bleiben zusätzlich für Korrekturen und künftige Turniere.

## Fehlerbehandlung

- Datenintegrität primär über Postgres-Constraints (NOT NULL, Foreign Keys)
  und RLS — keine doppelte Validierung in JS.
- Löschen referenzierter Teams/Courts wird per FK-Constraint verhindert
  (Fehlermeldung im UI: "Erst zugehörige Matches entfernen").
- Supabase-/Netzwerkfehler (inkl. RLS-Ablehnungen, z. B. Scorer versucht
  `finished` zu setzen) werden als Inline-Fehlermeldung im jeweiligen
  Formular angezeigt.

## Testing

Automatisiert, keine manuelle Test-Checkliste:

1. **Parser-Unit-Tests** — Node's eingebauter Test-Runner (`node --test`,
   keine Dependency) für den CSV/Sheet-Import-Parser: reale Sheet-Ausschnitte
   → erwartete Teams/Courts/Matches.
2. **RLS/Datenbank-Tests** — Supabase CLI mit lokalem Dev-Stack (`supabase
   start`, Docker-basiert, kein Cloud-Projekt nötig). Testsuite
   (`node --test` + `@supabase/supabase-js`) meldet sich als Admin/Scorer/
   `anon` an und prüft automatisiert alle Rollen-Grenzen aus dem
   Zugriffskontroll-Abschnitt sowie FK-Constraints. Läuft gegen die echten
   Migrationen und dient als Schema-Regressionstest für spätere
   Teilprojekte.
3. **UI-Smoke-Tests** — Playwright (headless), begrenzt auf kritische Pfade:
   Admin-Login + Match anlegen; Scorer-Login + blockierter
   `finished`-Versuch; anonymer Read-Zugriff.

Das Repo hat aktuell kein `package.json` (rein statisch bisher) — für die
Dev-Dependencies (Supabase CLI, Playwright) wird eins angelegt. CI-Einbindung
(z. B. GitHub Actions) ist nicht Teil dieser Spec, sondern Teil der
Umsetzungsplanung.

## Out of Scope (diese Spec)

- Digitale Sumula / Live-Scoring-UI (Teilprojekt 2)
- Automatischer Spielplan-Generator (Teilprojekt 3)
- Schiedsrichter-Zuweisungs-UI (Teilprojekt 4)
- Migration von `fistball-live` (Zuschauer-App) auf Supabase als
  Datenquelle (Teilprojekt 5)
- Spieler-Kader pro Team
- Individuelle Benutzerkonten / feingranulare Court-Rechte
- Offline-Fähigkeit (Konnektivität am Turnierort wird als stabil erwartet)
