# Faustball EMS — Teilprojekt 2: Digitale Sumula ("Game Report")

**Datum:** 2026-07-02
**Status:** approved (Design), pending spec review

## Kontext

Teilprojekt 1 (Fundament) ist abgeschlossen: Supabase-Backend mit vollständigem
Schema, RLS für Admin/Scorer/anon, und eine Admin-App mit CRUD für Turniere,
Kategorien, Courts, Teams und Matches. Das reale Juli-Turnier ist bereits
migriert und die Admin-App gegen die echte Produktions-DB verifiziert.

Dieses Teilprojekt baut die **digitale Sumula** — im Turnier offiziell
"Fistball Game Report" genannt (daher heißt der Nav-Punkt in der App **"Game
Report"**, nicht "Sumula"; "Sumula" bleibt nur der interne Projektname). Sie
ersetzt das Papier-/Excel-Formular, das Tischoffizielle (Recording Clerks)
bisher live am Spielfeldrand ausfüllen — bestätigt gelebte Praxis, keine neu
erfundene Anforderung (siehe Teilprojekt-1-Spec, Abschnitt zur
Punkt-für-Punkt-Erfassung).

Die Struktur des echten Formulars (Team-Registrierung mit Kader, Cautions,
Schiedsrichter-Team-Registrierung, Extraordinary Events, satzweise
Punkte-Aufzeichnung inkl. Time-outs, Unterschriften) wurde direkt aus dem
privaten Master-Sheet der Turnierleitung (Tabs `0`/Template und `16`/Beispiel)
sowie dem `DB`-Tab (Kader-Datenmodell: Family/Given Name, Role Player/Staff,
Player Position, Jersey Number, Staff Role, Team, Category) entnommen.

**Zeitdruck:** unverändert 3 Wochen bis zum Turnier (23.–26. Juli 2026).

## Ziel dieses Teilprojekts

Ein neuer **"Game Report"-Screen** in der bestehenden Admin-App, mit dem
Tischoffizielle (Rolle `scorer`) ein Match live punktgenau erfassen —
serverseitig regelkonform durchgesetzt (11-Punkte-Regel, 15:14-Hard-Cap,
mehrfaches Undo), plus Karten, Auswechslungen, Time-outs und Extraordinary
Events. Dazu ein neuer **Kader-Screen** für Admin (Stammdatenpflege vor dem
Turnier).

## Datenmodell

Neue Tabellen (zusätzlich zum bestehenden Schema aus Teilprojekt 1 — `sets`
und `point_events` existieren bereits und werden hier erstmals bespielt):

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `players` | Kader (Spieler + Staff) pro Team | `team_id`, `family_name`, `given_name`, `jersey_number` (nullable, nur Spieler), `role` (`player`\|`staff`), `player_position` (nullable, Freitext), `staff_role` (nullable, Freitext) |
| `player_events` | Karten pro Spieler und Match | `match_id`, `player_id`, `event_type` (`Y`\|`YR`\|`R`) |
| `substitutions` | Auswechslungen | `match_id`, `set_number`, `team_id`, `player_out_id`, `player_in_id` |
| `match_incidents` | Extraordinary Events | `match_id`, `incident_type` (`protest`\|`referee_report`\|`captain_time_violation`\|`other`), `team_id` (nullable), `note` |

Zusätzlich zwei neue Spalten auf der bestehenden `sets`-Tabelle:
`timeouts_a integer not null default 0`, `timeouts_b integer not null default 0`.

**Bewusst nicht übernommen** aus dem `DB`-Tab: Birthday, Height, # matches
national team, Link to Profile Pic — wirken für Grafik-/Broadcast-Zwecke
gedacht (es gibt eigene "Graphic men/women"-Tabs im Master-Sheet), nicht für
die Turnierverwaltung relevant. Können bei Bedarf später ergänzt werden.

Referentielle Integrität: `players.team_id` → `teams(id)` `on delete cascade`
(Kader gehört zum Team). `player_events.player_id`,
`substitutions.player_out_id`/`player_in_id` → `players(id)`
`on delete restrict` (verhindert stillen Verlust von Karten-/Wechsel-Historie).
`match_incidents.team_id` → `teams(id)` `on delete set null`.

## Regel-Engine (Postgres-RPCs)

Drei neue `security definer`-Funktionen, analog zu `start_match` aus
Teilprojekt 1:

**`record_point(p_match_id uuid, p_set_number integer, p_team text)`**
(`p_team` ∈ `'a'`, `'b'`):
1. Rollenprüfung (`admin` oder `scorer`), Match muss `status = 'live'` sein.
2. Legt die `sets`-Zeile für `(match_id, set_number)` bei Bedarf an (erster
   Punkt eines neuen Satzes).
3. Lehnt ab (`raise exception`), falls der Satz bereits `winner_team_id
   is not null` hat.
4. Erhöht `points_a`/`points_b` je nach `p_team`, fügt einen
   `point_events`-Eintrag ein (`team_id` wird aus `matches.team_a_id`/
   `team_b_id` anhand von `p_team` aufgelöst).
5. Sieg-Bedingung nach jedem Punkt: `(punkte >= 11 AND vorsprung >= 2) OR
   (punkte >= 15)` — deckt die reguläre 11-Punkte-Regel und den
   Sudden-Death-Hard-Cap bei 15:14 in einer Formel ab (bei strikter
   2-Punkte-Vorsprung-Regel ab 10:10 ist 15 Punkte nur erreichbar, wenn der
   Gegner exakt bei 14 steht — die Fallunterscheidung ist dadurch überflüssig).
6. Bei erfüllter Sieg-Bedingung: `winner_team_id` auf dem Satz setzen.

**`undo_last_point(p_match_id uuid, p_set_number integer)`**: gleiche
Rollen-/Status-Prüfung wie `record_point` (`admin`/`scorer`, Match muss
`live` sein). Findet das zuletzt eingefügte `point_events`-Row dieses Satzes,
reduziert den entsprechenden Zähler, löscht den Event, und setzt
`winner_team_id` zurück auf `null`, falls genau dieser Punkt den Satz
entschieden hatte. Kann beliebig oft hintereinander aufgerufen werden (App
erlaubt Mehrfach-Klick). Wirft einen Fehler, wenn es für diesen Satz nichts
zurückzunehmen gibt.

**`record_timeout(p_match_id uuid, p_set_number integer, p_team text)`**:
inkrementiert `timeouts_a`/`timeouts_b` auf der `sets`-Zeile. Gleiche
Rollen-/Status-Prüfung wie `record_point`; als RPC umgesetzt (statt direktem
Tabellenzugriff) aus Konsistenzgründen mit dem übrigen Zugriffsmodell.

Match-Ende (alle laut `matches.best_of` nötigen Sätze entschieden) wird
**nicht** in der Datenbank gespeichert, sondern von der UI aus den
vorhandenen `sets`-Zeilen berechnet. Der Admin bestätigt das Endergebnis
weiterhin manuell über den bestehenden `finished`-Button aus Teilprojekt 1 —
diese Grenze ändert sich nicht.

## Zugriffskontrolle (Änderungen gegenüber Teilprojekt 1)

- **Scorer verliert die bisherigen direkten `INSERT`/`UPDATE`-RLS-Policies
  auf `sets` und `point_events`** (aus Teilprojekt 1). Jede Punkt-/Timeout-
  Änderung läuft ab jetzt ausschließlich über die drei RPCs oben — die
  laufen `security definer` und prüfen die Rolle selbst, wodurch die
  (jetzt fehlenden) direkten Tabellen-Policies gezielt umgangen werden. Das
  ist der Standard-Weg, um harte Regeln zentral in einer Funktion statt
  verteilt über RLS-Policies durchzusetzen, und macht das Umgehen der
  Regel-Engine über einen direkten API-Aufruf unmöglich.
- **`players`**: Admin volles CRUD (Stammdaten wie Teams/Courts — Kader wird
  vor dem Turnier gepflegt, nicht live während des Matches).
- **`player_events`, `substitutions`, `match_incidents`**: Scorer
  `INSERT`/`UPDATE`/`DELETE` (Live-Erfassung während des Matches, inklusive
  Korrekturmöglichkeit). Kein Admin-Schreibzugriff — gleiche Domänentrennung
  wie bei `sets`/`point_events`: Scorer verantwortet das Live-Match, Admin
  verantwortet Stammdaten und die finale Freigabe.
- **Lesend**: wie immer offen für alle Rollen inklusive `anon`.

## UI-Scope

Neuer Nav-Punkt **"Game Report"** in der Admin-App (primär für Scorer,
aber auch von Admin nutzbar zur Kontrolle):

1. **Match-Auswahl**: Turnier → Kategorie → Match (gleiches Muster wie
   bestehende Screens), gefiltert auf Status `scheduled`/`live`.
2. **Kopfbereich**: Team A vs. Team B, Court, Best-of, zugewiesene
   Schiedsrichter aus `referee_assignments` (nur Anzeige, keine Erfassung —
   das bleibt Teilprojekt 4).
3. **"Match starten"**: ruft die in Teilprojekt 1 vorbereitete, bisher
   ungenutzte `start_match`-RPC auf (`scheduled` → `live`).
4. **Live-Scoring**: große Tap-Flächen "+1 Team A" / "+1 Team B" (→
   `record_point`), Undo-Button (→ `undo_last_point`, mehrfach klickbar),
   Timeout-Buttons pro Team (→ `record_timeout`). Anzeige des aktuellen
   Satzstands plus bereits abgeschlossener Sätze.
5. **Karten**: Spieler-Dropdown pro Team (aus `players`, gefiltert auf
   `role = 'player'`) + Y/YR/R-Auswahl → `player_events`.
6. **Auswechslung**: Spieler-raus-/Spieler-rein-Dropdown aus dem Kader des
   jeweiligen Teams + aktueller Satz → `substitutions`.
7. **Sonstiges** (Extraordinary Events): Typ-Auswahl
   (Protest/Schiedsrichterbericht/Zeitstrafe Kapitän/Sonstiges) + optionale
   Notiz + optionales Team → `match_incidents`.
8. **Match-Status-Banner**: sobald laut `best_of` genug Sätze entschieden
   sind, informativer Hinweis ("Match entschieden (X:Y) — wartet auf
   Freigabe durch Admin"), kein eigener Button.

Zusätzlich ein neuer **Kader-Screen** für Admin (`players` CRUD, analog zum
Teams-Screen aus Teilprojekt 1) zur Vorbereitung vor dem Turnier.

## Fehlerbehandlung

- RPC-Ablehnungen (falsche Rolle, Match nicht `live`, Satz bereits
  entschieden, nichts zum Undo) kommen als Fehlermeldung vom Server zurück
  und werden inline im Game-Report-Screen angezeigt — gleiches Muster wie in
  Teilprojekt 1.
- Punkt-/Timeout-Buttons werden während einer laufenden Anfrage kurz
  deaktiviert, um Doppel-Taps bei langsamer Verbindung zu verhindern. Kein
  optimistisches UI-Update vor Serverbestätigung — die Regel-Engine
  entscheidet serverseitig, die UI zeigt nur den bestätigten Zustand.

## Testing

- **RPC/RLS-Tests** (wie Teilprojekt 1, `node --test` gegen lokalen
  Supabase-Stack): `record_point`-Sequenzen bis 11:9 (reguläres Ende) und bis
  15:14 (Hard-Cap); `undo_last_point` inklusive Rückgängigmachen eines
  satzentscheidenden Punkts; Rollen-Grenzen (weder Admin noch Scorer dürfen
  nach dieser Änderung noch direkt in `sets`/`point_events` schreiben, nur
  über die RPCs).
- **Playwright-Smoke-Test**: ein Match starten, mehrere Punkte erfassen bis
  ein Satz endet, einmal Undo nutzen, eine Karte vergeben, eine Auswechslung
  erfassen — ein kritischer Pfad einmal end-to-end durch die echte UI.

## Out of Scope (diese Spec)

- Öffentliche Live-Anzeige des laufenden Punktestands (bleibt Teilprojekt 5 —
  `fistball-live` liest weiterhin vom Google Sheet, keine Umstellung hier).
- Schiedsrichter-Zuweisung/-Erfassung (bleibt Teilprojekt 4 — Game Report
  zeigt nur an, was dort ggf. schon erfasst wurde).
- Zusätzliche Kader-Felder ohne EMS-Bezug (Geburtstag, Größe, Länderspiele,
  Profilbild-Link).
- Harte Regel-Durchsetzung für Time-out-Obergrenzen (nur Zähler, keine
  Validierung gegen ein Maximum pro Satz).
- Automatischer Übergang von `matches.status` auf `finished`, wenn laut
  Satzstand rechnerisch entschieden — bleibt manuelle Admin-Aktion.
