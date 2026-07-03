# Faustball EMS — Teilprojekt 5: Standings/Dashboard

**Datum:** 2026-07-03
**Status:** approved (Design), pending spec review

## Kontext

Teilprojekt 1 (Fundament), Teilprojekt 2 (Digitale Sumula / Game Report),
Teilprojekt 3 (Spielplan-Generator) und Teilprojekt 4
(Schiedsrichter-Zuweisung) sind abgeschlossen und in `main` gemergt. Die
Admin-App hat jetzt ein vollständiges Supabase-Backend für Turniere,
Kategorien, Courts, Teams, Kader, Matches (inkl. KO-Skelett), Live-Scoring,
Spielplan-Generierung und Schiedsrichter-Zuweisung.

Der öffentliche Viewer (`fistball-live`-Hauptverzeichnis: `index.html`,
`app.js`, `styles.css`) ist bisher unverändert eine reine
Frontend-PWA ohne eigenes Backend, die direkt vom öffentlich freigegebenen
Google Sheet liest (Google-Visualization-CSV-Endpoint) und daraus
Turnier-Standings mit Tiebreaker-Logik, Spielergebnisse, KO-Bracket und
Karten-Statistiken für Zuschauer:innen berechnet und anzeigt. Diese
Sheet-Abhängigkeit ist inzwischen die letzte verbliebene — die Admin-App ist
seit Teilprojekt 1 die tatsächliche Quelle der Wahrheit für Turnierdaten,
das Sheet wird nicht mehr gepflegt.

Eine Prüfung von `tournaments.config` (laut Teilprojekt-1-Spec vorgesehen
für Scoring-/Tiebreaker-Regeln) zeigt: das Feld wurde nie befüllt (`{}` in
Produktion) — die App nutzt aktuell die eingebauten IFA-Default-Regeln.

## Ziel dieses Teilprojekts

Der öffentliche Viewer liest ausschließlich noch von Supabase, nicht mehr
vom Google Sheet. Die komplette Standings-/Tiebreaker-/Bracket-Logik in
`app.js` bleibt unverändert (Minimal-invasiver Ansatz) — nur die
Daten-Beschaffungsschicht wird ersetzt, sodass alle nachgelagerten
Funktionen weiter auf denselben Objektformen arbeiten wie heute.

## Architektur

- **Nur die Datenbeschaffungsschicht wird ersetzt**: `load()`,
  `applyData()`, `parseCSV()`, `rowToMatch()`, `cleanTeam()`, `parseRules()`,
  `parseCautions()`, `CONFIG_URL`/`DATA_URL`/`CAUTIONS_URL` werden durch
  Supabase-Query-Funktionen ersetzt, die dieselben Ziel-Objektformen
  erzeugen. `computeStandings()`, `aggregate()`, `criterionValues()`,
  `breakTies()`, `renderStandings()`, `renderKnockout()`,
  `renderCategories()`, `renderMatches()`, `renderCards()` und alle übrigen
  Render-Funktionen bleiben **byte-identisch**.
- Neuer Supabase-Client direkt im Root-Verzeichnis, via `esm.sh`-CDN-Import
  (`import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`)
  — identisches Muster zu `admin/supabase-client.js`, kein Bundler, keine
  neue Build-Abhängigkeit. Nutzt die öffentliche `anon`-Rolle (nur Lesen,
  keine Anmeldung nötig — wie schon in der gesamten Admin-App für
  Lesezugriffe etabliert).
- `index.html` wechselt `<script src="app.js">` zu
  `<script type="module" src="app.js">` (nötig für ES-Modul-Import). Keine
  Inline-Event-Handler im HTML vorhanden (geprüft) — unauffälliger Wechsel,
  kein Scoping-Risiko.
- **Polling alle 60s bleibt** (`CONFIG.refreshMs`), jetzt gegen
  Supabase-Queries statt Sheet-Fetch — keine Realtime-Subscription in
  diesem Teilprojekt.
- **Ein aktives Turnier**: die App lädt das eine Turnier aus `tournaments`
  (`select().limit(1).single()`, bestätigt aktuell genau eine Zeile in
  Produktion) — analog zur heutigen festen `CONFIG.sheetId`.
- `localStorage`-Caching (`fb_cache`, `fb_rules`, `fb_cautions`) bleibt als
  Offline-Fallback erhalten — gecachter Inhalt wechselt von CSV-Text zu den
  bereits gemappten Objekten (JSON), gleiche Funktion (App bleibt nutzbar,
  wenn Supabase kurz nicht erreichbar ist).

## Datenabbildung — Matches

Eine Query lädt alle Matches des Turniers mit Joins auf `teams`, `courts`,
`categories`, `team_a_source_match`/`team_b_source_match` (für unaufgelöste
KO-Slots aus Teilprojekt 3) sowie die zugehörigen `sets`-Zeilen — analog zu
den bestehenden `listMatches`/`listMatchesForTournament`-Mustern aus der
Admin-App, **sortiert nach `scheduled_time`**. `renderMatches()` gruppiert
Matches nach `m.day` in der Reihenfolge, in der sie in `state.matches`
vorkommen (bisher implizit die chronologische Sheet-Zeilenreihenfolge) —
ohne explizites `order by scheduled_time` in der Query würde diese
Gruppierung nicht mehr verlässlich chronologisch sortiert sein. Für jedes
Match wird ein Objekt in der **exakt gleichen Form wie `rowToMatch()`**
heute erzeugt:

- `status`: Mapping `scheduled`/`live`/`finished` →
  `"Not Started"`/`"In progress"`/`"Finished"` (Sheet-Wortlaut wird
  beibehalten, da `isFinished()`/`isLive()`/`statusClass()` exakt darauf
  matchen).
- `teamA`/`teamB`: bei aufgelöstem Team der echte Name; bei unaufgelöstem
  KO-Slot ein Platzhalter-String im selben Stil wie in der Admin-App
  (`"Sieger von Match #X"` bzw. `"Verlierer von Match #X"`, aus
  `team_a_source_match`/`team_a_source_outcome` abgeleitet). Die bestehende
  `isRealTeam()`-Prüfung wird so angepasst, dass sie diesen Platzhalter-Stil
  als "nicht real" erkennt (bisher erkannte sie die Sheet-eigenen
  Platzhalter-Konventionen).
- `sets`: aus den `sets`-Zeilen des Matches gebaut (`points_a`/`points_b`
  je Satz); `setsA`/`setsB` aus der Anzahl gewonnener Sätze
  (`sets.winner_team_id`) abgeleitet.
- `pointsA`/`pointsB`: Summe aller `points_a`/`points_b` über alle Sätze.
- `bestOf`, `round` (= `round_label`), `court` (= `courts.name`), `category`
  (= `categories.name`), `nr` (= `sheet_match_nr`, falls vorhanden — bei
  künftigen, nicht aus dem Sheet migrierten Matches als Fallback eine
  synthetische, stabile Kennung aus der Match-`id`), `day`/`time` (aus
  `scheduled_time` abgeleitet, `null` falls nicht gesetzt).

## Datenabbildung — Cards

Eine Query liest `player_events` (Teilprojekt 2) gejoined mit `players`
(Name, Rückennummer, Team) und `matches` (für die "Game"-Spalte, z. B.
Rundenbezeichnung) für das gesamte Turnier und aggregiert sie zur selben
Objektform wie `parseCautions()` heute: `{team, teamName, category, nr,
name, first, y, yr, r, events}`. `renderCards()` bleibt unverändert.

## Regelwerk

Die App liest `tournaments.config` zur Laufzeit (wie heute das Config-Tab)
— kein CSV-Parsing mehr nötig, `config` ist bereits JSON mit der Struktur
`{pointTable, drawPoints, tiebreakers}`. Fehlt ein Feld (oder ist `config`
leer, wie aktuell in Produktion), greift pro Feld der bestehende
`DEFAULT_RULES`-Fallback — exakt das gleiche "Config ist optional"-Verhalten
wie heute, nur die Quelle wechselt von CSV-Fetch zu Supabase-Spalte. Kein
UI zum Bearbeiten von `config` in diesem Teilprojekt (nur Lesen) — wird
`config` später befüllt, greift es automatisch ohne Code-Änderung.

## Testing

- **Unit-Tests** für die neue Mapping-Schicht (Supabase-Rohdaten →
  `match`/`caution`-Objektform), analog zu
  `scripts/__tests__/parse-sheet.test.mjs`: Status-Mapping, KO-Platzhalter-
  Label (inkl. Fall ohne Platzhalter — normales aufgelöstes Match), Satz-/
  Punkte-Aggregation, `bestOf`/`round`/`court`/`category`-Durchreichung,
  Cards-Aggregation (Y/YR/R-Zählung, Gruppierung nach Spieler), Regelwerk-
  Fallback (leeres `config` → Defaults; teilweise befülltes `config` →
  Mischung aus Config-Werten und Defaults für fehlende Felder). Reine
  Funktionen mit Fixture-Eingaben, keine echte DB nötig.
- **Kein Playwright-Test** in diesem Teilprojekt — der öffentliche Viewer
  hat keine bestehende E2E-Testinfrastruktur, und der Umbau ist auf die
  Datenschicht beschränkt (Standings-/Bracket-/Render-Logik bleibt
  unverändert und dadurch weiter durch die visuelle Prüfung des
  Endergebnisses abgedeckt). Verifikation nach Deploy: Standings, Bracket,
  Matches, Cards visuell mit den echten Produktionsdaten vergleichen.

## Out of Scope (diese Spec)

- Live-Punkt-für-Punkt-Anzeige (bleibt laut früherer Entscheidung
  "vorerst nur intern").
- Schiedsrichter-Anzeige im öffentlichen Viewer (heute nicht vorhanden,
  bleibt so).
- Mehrere gleichzeitige Turniere (heute wie künftig: ein aktives Turnier).
- Supabase-Realtime (Polling alle 60s bleibt, wie besprochen).
- UI zum Bearbeiten von `tournaments.config` (nur Lesen in diesem
  Teilprojekt).
- Google-Sheet-Fallback bei Supabase-Ausfall (Sheet wird komplett
  abgelöst, wie besprochen — `localStorage`-Cache bleibt als einziger
  Offline-Fallback).
