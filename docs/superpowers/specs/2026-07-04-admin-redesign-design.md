# Faustball EMS — Teilprojekt 6: Admin-Redesign + Refactor

**Datum:** 2026-07-04
**Status:** approved (Design), pending spec review

## Kontext

Teilprojekte 1–5 sind abgeschlossen: Die Admin-App (`admin/`) ist funktional
vollständig (Turniere, Kategorien, Courts, Teams, Kader, Matches, Spielplan,
Schiedsrichter, Game Report), der öffentliche Viewer liest von Supabase.

Optisch ist der Admin aber roh geblieben: `admin/styles.css` hat 18 Zeilen,
ungestylte Tabellen und Formulare, keine Mobile-Optimierung. Der Viewer
(`styles.css` im Root) hat dagegen ein fertiges dunkles Designsystem
(identisch mit der Referenz https://c-englert.github.io/fistball-live/).

Zweiter Schmerzpunkt: Jeder Admin-Screen rendert eigene Turnier-/Kategorie-
Selects (`c_tournament`, `team_tournament`, `match_tournament`,
`sg_tournament`, `ref_tournament`, `court_tournament`, …) — man wählt auf
jedem Screen neu aus. Außerdem wiederholen die 9 Screens dasselbe
CRUD-Muster (Tabelle + Formular + Fehler-Absatz) mit kopiertem Code.

## Ziel dieses Teilprojekts

1. Der Admin übernimmt das Designsystem des Viewers (Farben, Radius,
   Schatten, Typografie) und wird voll responsive (Laptop + Handy —
   Turnierleitung am Laptop, Game Report auch am Handy am Spielfeld).
2. Turnier- und Kategorie-Auswahl werden **globaler Kontext** in einer
   Kontext-Leiste unter dem Header, persistiert in `localStorage`; die
   Screens rendern keine eigenen Selects mehr.
3. Gemeinsame UI-Helfer (`admin/ui.js`) ersetzen das kopierte
   CRUD-Boilerplate der Screens.

Kein Datenbank-/RLS-Umbau, keine funktionalen Änderungen an
Spielplan-Generator, Schiedsrichter-Zuweisung oder Game-Report-Logik.

## Architektur

### Designsystem (`admin/styles.css`, neu geschrieben)

- Übernimmt die `:root`-Tokens des Viewers 1:1: `--bg: #0b1220`,
  `--bg-elev`, `--bg-elev-2`, `--line`, `--text`, `--muted`,
  `--accent: #4f8cff`, `--accent-2`, `--live`, `--radius: 14px`,
  `--shadow`, gleiche Font-Stack.
- Admin-spezifische Bausteine darauf aufbauend:
  - Buttons: `.btn` (primary = accent), `.btn--danger` (live-rot),
    `.btn--ghost` (transparent mit Border), Fokus-Ringe via
    `:focus-visible`.
  - Formularfelder: einheitliche Inputs/Selects/Labels auf
    `--bg-elev`-Flächen.
  - Karten (`.panel`): Inhaltsflächen mit `--bg-elev`, `--radius`,
    `--shadow` — Screens rendern in Panels statt direkt auf `--bg`.
  - Tabellen: gestylte `thead`, Zebra-freie Zeilen mit `--line`-Trennern,
    auf dem Handy horizontal scrollbar in einem `.table-wrap`
    (Muster aus dem Viewer).
  - Toasts (`.toast`): Erfolg/Fehler unten rechts (Desktop) bzw. unten
    mittig (Handy), auto-dismiss bei Erfolg, Fehler bleiben bis Klick.
  - Leere-Zustände (`.empty`): Muster aus dem Viewer übernommen.

### Layout (`admin/index.html`)

- Sticky Header wie im Viewer: IFA-Logo (`assets/ifa-mark.svg`),
  Titel „Fistball EMS — Admin", rechts Rolle + Logout.
- Darunter **Kontext-Leiste**: Turnier-Select + Kategorie-Select,
  immer sichtbar (sticky zusammen mit dem Header).
- Darunter Navigation: horizontal scrollbare Pills (Viewer-Optik
  `.pill`), auf Desktop eine volle Reihe. Aktiver Screen = aktive Pill.
- Login wird eine zentrierte Karte im gleichen Stil (Logo, Titel,
  Felder, Fehler inline).

### Globaler Kontext (`admin/context.js`, neu)

- API: `getTournamentId()`, `getCategoryId()`, `onContextChange(fn)`,
  `initContext()` (lädt Turniere/Kategorien, stellt Auswahl aus
  `localStorage` wieder her, rendert die Selects der Kontext-Leiste).
- Turnierwechsel lädt die Kategorien des Turniers nach und setzt die
  Kategorie auf die erste (bzw. die persistierte, falls noch vorhanden).
- Kontextwechsel rendert den aktiven Screen neu (über den bestehenden
  `showScreen`-Mechanismus in `admin/app.js`).
- Persistenz-Keys: `ems_tournament`, `ems_category`.
- Scope pro Screen:
  - **Turnier-Ebene** (nutzen nur `getTournamentId()`): Kategorien,
    Courts, Schiedsrichter. Der Kategorie-Select in der Kontext-Leiste
    wird auf diesen Screens ausgegraut (sichtbar, aber inaktiv), damit
    die Leiste nicht springt.
  - **Kategorie-Ebene** (nutzen beide): Teams, Kader, Matches, Spielplan,
    Game Report.
  - **Ohne Kontext**: Turnier-Screen (verwaltet die Turniere selbst).
- Sonderfall Schiedsrichter-Screen: Die dortige Zuweisungs-Sektion hat
  einen eigenen Kategorie-**Multi**-Select (`assign_category`) für die
  Auto-Zuweisung über mehrere Kategorien — der bleibt screen-lokal
  erhalten; nur der Turnier-Select (`ref_tournament`) entfällt.

### UI-Helfer (`admin/ui.js`, neu)

- `dataTable({ columns, rows, rowActions })` → HTML-String einer Tabelle
  im `.table-wrap`; `rowActions` erzeugt Buttons mit `data-*`-Attributen,
  Event-Bindung bleibt beim Screen.
- `formRow(label, inputHtml)` / `entityForm({ fields, submitLabel })` →
  einheitliches Formular-Markup.
- `showToast(message, { type: 'success' | 'error' })`.
- `confirmDelete(message)` → `Promise<boolean>`; eigener kleiner
  Modal-Dialog im Designsystem (kein natives `confirm()`), damit
  Playwright ihn deterministisch bedienen kann.
- `loading(host)` / `emptyState(message)` → Lade-/Leere-Markup.
- `escapeHtml` zieht von `db.js` nach `ui.js` um (Re-Export in `db.js`
  bleibt für die Übergangszeit erhalten, damit kein Screen bricht).

### Screen-Refactor

- Die 5 einfachen CRUD-Screens (Turniere, Kategorien, Courts, Teams,
  Kader) schrumpfen auf: Kontext lesen → Daten laden → `dataTable` +
  `entityForm` rendern → Submit/Delete-Handler. Kein eigener
  Select-Code, keine eigene Tabellen-/Fehler-Markup-Kopie mehr.
- Die 4 komplexen Screens (Matches, Spielplan, Schiedsrichter,
  Game Report) behalten ihre Struktur und Logik, ersetzen aber ihre
  Selects durch den Kontext und ihr Ad-hoc-Markup durch die Helfer
  (Panels, Tabellen, Toasts, Buttons).
- Alle destruktiven Aktionen (Löschen von Turnier, Kategorie, Court,
  Team, Spieler, Match, Zuweisung) laufen über `confirmDelete()`.
- Game Report: große Touch-Ziele für die Punkte-/Satz-Buttons
  (min. 44×44 px), einspaltiges Layout auf dem Handy.

## UX-Verhalten

- Beim ersten Login ohne persistierten Kontext: erstes Turnier + erste
  Kategorie werden vorausgewählt (heutiges Verhalten der Screens).
- Existiert kein Turnier, zeigen kontextabhängige Screens einen
  Leere-Zustand mit Hinweis „Lege zuerst ein Turnier an" + Link auf den
  Turnier-Screen.
- Fehler bei Mutationen: Toast (Fehlertyp) statt still wachsender
  Fehler-Absätze; Formular-Validierungsfehler bleiben inline am Feld.
- Ladezustände: Screens zeigen `loading()` während der Erstabfrage.

## Testing

- **E2E (Playwright, bestehende 4 Specs anpassen):** Die Specs wählen
  Turnier/Kategorie künftig über die Kontext-Leiste (stabile IDs
  `#ctx_tournament`, `#ctx_category`) statt über screen-eigene Selects.
  Die Formular-Feld-IDs der Screens (`#t_name`, `#c_name`, …) bleiben
  unverändert, damit die Anpassung klein bleibt. Neue Assertions:
  Kontext bleibt über Screen-Wechsel erhalten; `confirmDelete`-Dialog
  wird im Lösch-Flow bestätigt.
- **Unit-Tests:** unverändert (Generator-Tests hängen nicht am UI).
  `ui.js`-Helfer, die reine HTML-Strings bauen (`dataTable`,
  `entityForm`), bekommen kleine `node --test`-Tests (Escaping,
  Spalten-/Feld-Rendering).
- **Manuell:** Smoke-Test aller 9 Screens auf Desktop-Breite und
  ~390 px (Handy), Game Report zusätzlich auf Touch-Bedienbarkeit.

## Out of Scope (diese Spec)

- Keine Änderungen an Datenbank, RLS oder `db.js`-Queries (außer dem
  `escapeHtml`-Umzug).
- Keine neuen Admin-Funktionen (nur Umbau von Darstellung, Navigation
  und Code-Struktur).
- Kein Dark/Light-Umschalter — der Admin ist dunkel wie der Viewer.
- Keine PWA-/Offline-Fähigkeit für den Admin.
- Der öffentliche Viewer bleibt in diesem Teilprojekt unangetastet
  (Teilprojekte 7 und 8).
