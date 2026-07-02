# Faustball EMS — Teilprojekt 3: Spielplan-Generator

**Datum:** 2026-07-02
**Status:** approved (Design), pending spec review

## Kontext

Teilprojekt 1 (Fundament) und Teilprojekt 2 (Digitale Sumula / Game Report)
sind abgeschlossen und in `main` gemergt. Der komplette Spielplan des realen
Juli-Turniers (Matches 16–75, inklusive KO-Runden mit bereits aufgelösten
Teams) ist über die Einmal-Migration aus Teilprojekt 1 schon vollständig in
der Produktions-DB vorhanden — eine Prüfung der echten Daten hat das
bestätigt.

Der Spielplan-Generator ist deshalb **nicht** als Voraussetzung für das
Juli-Event gedacht, sondern dient zwei Zwecken:

1. **Korrektur-/Ergänzungswerkzeug** für den bestehenden Juli-Plan (z. B.
   Nachrücker, fehlende Platzierungsspiele, Zeit-/Court-Korrekturen einzelner
   Kategorien).
2. **Wiederverwendbares Werkzeug** für künftige Turniere, die nicht mehr über
   ein Google Sheet + Einmal-Migration, sondern direkt in der Admin-App
   geplant werden sollen.

Eine Prüfung der echten Turnierstruktur (bestehende `matches`-Daten,
`app.js`-Bracket-Logik) zeigt zwei grundsätzlich verschiedene Phasen:

- **Gruppenphase**: ein Round-Robin innerhalb einer Kategorie (z. B. "U18 M
  Gold", 4 Teams, 6 Matches). Alle Teams sind von Anfang an bekannt.
- **KO-/Platzierungsphase**: oft eine **eigene Kategorie**, die Teams aus
  mehreren Gruppen kombiniert (z. B. "U18 Men" kombiniert Teams aus "U18 M
  Gold" und "U18 M Silver"). Die Zuordnung "wer aus welcher Gruppe kommt in
  welchen Bracket-Slot" folgt keinem festen, generischen Muster (variiert pro
  Kategorie/Reglement) und wird deshalb **nicht automatisiert** — nur die
  Fortsetzung *innerhalb* der KO-Phase (Sieger/Verlierer-Ketten wie "Winner
  SF1") ist mechanisch und wird automatisiert.

## Ziel dieses Teilprojekts

Zwei unabhängige Bausteine in der bestehenden Admin-App:

1. Ein **Gruppenphasen-Generator**: aus Teams + Courts + Zeitfenster werden
   automatisch kollisionsfreie Round-Robin-Paarungen mit Court-/Zeit-Zuteilung
   erzeugt.
2. Eine **KO-/Platzierungs-Skelett-Funktion mit Auto-Auflösung**: Matches
   können statt eines festen Teams eine Quelle ("Sieger von Match #X" /
   "Verlierer von Match #X") bekommen, die sich automatisch auflöst, sobald
   das Quell-Match beendet wird.

## Datenmodell

Änderungen an der bestehenden `matches`-Tabelle (aus Teilprojekt 1):

| Spalte | Änderung | Zweck |
|---|---|---|
| `team_a_id`, `team_b_id` | `NOT NULL` → nullable | Ein Match kann jetzt "auf Auflösung wartend" ohne bekanntes Team existieren |
| `team_a_source_match_id` | neu, `uuid references matches(id) on delete set null` | Quell-Match für Team A, falls nicht fest zugewiesen |
| `team_a_source_outcome` | neu, `text check (team_a_source_outcome in ('winner','loser'))` | Ob Team A der Sieger oder Verlierer des Quell-Matches ist |
| `team_b_source_match_id` | neu, analog zu `team_a_source_match_id` | Quell-Match für Team B |
| `team_b_source_outcome` | neu, analog zu `team_a_source_outcome` | Sieger/Verlierer-Auswahl für Team B |
| `winner_team_id` | neu, `uuid references teams(id) on delete set null` | Ergebnis von `finish_match()` — bisher gab es nur satzweise Gewinner (`sets.winner_team_id`), keinen persistenten Match-Gewinner |

**Constraint:** ein Match muss entweder ein festes Team **oder** eine Quelle
pro Seite haben, nicht beides und nicht keins:

```sql
alter table matches add constraint team_a_fixed_xor_source
  check ((team_a_id is not null) <> (team_a_source_match_id is not null));
alter table matches add constraint team_b_fixed_xor_source
  check ((team_b_id is not null) <> (team_b_source_match_id is not null));
```

`team_a_source_outcome`/`team_b_source_outcome` sind nur sinnvoll gesetzt,
wenn die jeweilige `..._source_match_id` gesetzt ist — durchgesetzt in der
Anwendungsschicht (Admin-Formular erlaubt keine widersprüchliche Kombination),
nicht per zusätzlichem DB-Constraint, um das Schema nicht zu überladen.

Keine neuen Tabellen. Die bestehende `on delete restrict`-Regel für
`matches.team_a_id`/`team_b_id → teams(id)` bleibt für gesetzte Werte
unverändert.

## Regel-Engine (Postgres-RPCs)

**`finish_match(p_match_id uuid, p_winner_team_id_override uuid default null)`**
(ersetzt das bisherige direkte `UPDATE matches SET status = 'finished'` durch
Admin):

1. Rollenprüfung (`admin`), Match darf noch nicht `status = 'finished'` sein
   (Idempotenz-Schutz). **Korrektur ggü. einem ersten Entwurf dieser Spec:**
   anders als bei `record_point` gab es beim bisherigen direkten
   `UPDATE ... SET status = 'finished'` **keine** Vorbedingung auf `'live'` —
   Admins finishen heute auch Matches, die nie über `start_match()` liefen
   (z. B. Ergebnis nachträglich ohne Live-Scoring erfasst, siehe bestehender
   e2e-Test `admin can create a match and mark it finished`). Diese Fähigkeit
   bleibt erhalten: `finish_match()` erlaubt sowohl `status = 'scheduled'`
   als auch `status = 'live'` als Ausgangszustand.
2. **Ohne Override** (`p_winner_team_id_override is null`, der Normalfall):
   berechnet den Gewinner aus den vorhandenen `sets`-Zeilen — das Team mit der
   Mehrheit der laut `best_of` nötigen gewonnenen Sätze
   (`sets.winner_team_id` pro Satz zusammengezählt). Wirft einen Fehler, falls
   danach kein eindeutiger Gewinner feststeht (Match rechnerisch noch nicht
   entschieden) — verhindert ein verfrühtes Finish, das bisher nur durch
   Disziplin des Admins verhindert wurde.
3. **Mit Override**: für Sonderfälle, in denen der Satzstand kein
   vollständiges Ergebnis widerspiegelt (Forfeit, No-Show, Spielabbruch) — der
   Admin bestimmt den Gewinner explizit statt ihn aus Sätzen ableiten zu
   lassen. `p_winner_team_id_override` muss `matches.team_a_id` oder
   `matches.team_b_id` des Matches sein, sonst Fehler. Überspringt die
   Vollständigkeitsprüfung aus Schritt 2 komplett.
4. Setzt `status = 'finished'` und `winner_team_id` (aus Schritt 2 oder 3) auf
   dem Match.
5. Sucht alle Matches mit `team_a_source_match_id = p_match_id` oder
   `team_b_source_match_id = p_match_id` und befüllt dort `team_a_id`
   bzw. `team_b_id` mit `winner_team_id` (falls `..._source_outcome =
   'winner'`) oder dem jeweils anderen Team (falls `'loser'`). Löscht dabei
   die entsprechende `..._source_match_id`/`..._source_outcome`-Zuordnung
   (Slot ist jetzt fest belegt).
6. **Keine mehrstufige Kettenreaktion**: aufgelöste Folge-Matches bleiben
   `scheduled`, bis sie regulär gespielt und selbst über `finish_match()`
   beendet werden. Jede Ebene der KO-Phase erfordert ein echtes Spiel
   dazwischen — es gibt nichts, das automatisch mehrere Runden auf einmal
   auflösen könnte.

**`generate_round_robin(...)`**: bewusst **keine** RPC — die
Paarungs-/Slot-Berechnung läuft clientseitig in der Admin-App (reine
Funktion, keine Rollenprüfung nötig, da nur eine Vorschau berechnet wird).
Erst das tatsächliche Anlegen der Matches nutzt die bestehenden,
rollengeprüften `INSERT`-Policies auf `matches` (Admin-only, unverändert aus
Teilprojekt 1).

## Zugriffskontrolle (Änderungen gegenüber Teilprojekt 1/2)

- **Direktes `UPDATE matches SET status = 'finished'` durch Admin wird
  revoked** — analog zur Verschärfung, die Teilprojekt 2 für `sets`/Scorer
  vorgenommen hat. Einzig `finish_match()` darf diesen Übergang auslösen.
  Andere Felder (`scheduled_time`, `court_id`, `round_label`, `team_a_id`
  bei fest zugewiesenen Teams, …) bleiben weiterhin per Direkt-`UPDATE`
  durch Admin änderbar wie bisher.
- Keine neuen Rollen. `team_a_source_match_id`/`team_b_source_match_id`
  können nur von Admin gesetzt werden (Teil des bestehenden
  Matches-`INSERT`/`UPDATE`-Rechts).
- Lesend weiterhin offen für alle Rollen inklusive `anon`.

## UI-Scope

**1. Gruppenphasen-Generator** (neuer Abschnitt im Matches- oder eigenen
"Spielplan"-Screen):

- Formular: Kategorie (→ Teams vorbelegt, abwählbar), Court-Mehrfachauswahl
  (aus bestehenden `courts`), Start-Datum/-Zeit, Match-Dauer (Minuten), Pause
  zwischen Matches (Minuten), End-Datum, `round_label`-Text, `best_of`.
- **Circle-Method** für die Paarungen (ungerade Teamzahl → Freilos-Runde wird
  beim Slot-Mapping übersprungen).
- **Slot-Zuteilung**: iteriert über Zeitslots (Start → Ende in Schritten von
  Dauer + Pause, über die gewählten Tage) × gewählte Courts. Prüft
  Kollisionen gegen **alle** existierenden Matches im Turnier (nicht nur der
  gewählten Kategorie) — ein belegter Court/Zeit-Slot wird übersprungen.
  Reicht der Zeitraum nicht aus: Fehlermeldung mit Anzahl fehlender Slots,
  keine Teilerzeugung.
- **Vorschau vor dem Schreiben**: berechnete Paarungen + zugewiesene
  Slots werden clientseitig angezeigt (Tabelle: Team A, Team B, Zeit, Court);
  erst ein zweiter, expliziter Klick legt die `matches`-Zeilen an.
- **Regenerierung**: hat die Kategorie bereits Matches, zeigt das Formular
  eine Warnung ("X bestehende Matches werden ersetzt"). Erlaubt nur, wenn
  **alle** bestehenden Matches der Kategorie noch `status = 'scheduled'`
  sind — sonst Fehlermeldung, keine stille Löschung von laufenden/beendeten
  Matches samt Sätzen. Bei Bestätigung: alte Matches der Kategorie löschen
  (kaskadiert zu `sets`/`point_events` etc. über bestehende
  `on delete cascade`), neue anlegen.

**2. KO-/Platzierungs-Skelett** (Erweiterung des bestehenden
Match-Anlege-/Bearbeiten-Formulars aus Teilprojekt 1):

- Pro Seite (Team A/B) ein Umschalter: **"Festes Team"** (bestehendes
  Dropdown) oder **"Sieger/Verlierer von Match #"** (Dropdown mit
  Matches des Turniers, angezeigt als `#<sheet_match_nr oder Kurz-ID>
  <round_label> (<TeamA> vs <TeamB>)`, plus Sieger/Verlierer-Radiobutton).
- **Anzeige offener Slots** in der Matches-Liste: statt eines Teamnamens
  erscheint kursiv/grau "Sieger von #52" bzw. "Verlierer von #52", solange
  `team_a_id`/`team_b_id` `null` ist.
- Der bestehende "Als beendet markieren"-Button (Teilprojekt 1) ruft jetzt
  `finish_match(p_match_id)` statt direktem Update auf; Fehlermeldungen
  (Match bereits `finished`, kein eindeutiger Gewinner) erscheinen inline wie
  gewohnt.
- Zusätzlicher Link/Button "Forfeit / manuelles Ergebnis" öffnet einen
  Team-A/Team-B-Auswahldialog und ruft `finish_match(p_match_id,
  p_winner_team_id_override)` auf — für Sonderfälle ohne vollständigen
  Satzstand.

## Fehlerbehandlung

- Generator-Vorschau meldet fehlende Slots, statt eine unvollständige Runde
  im Formular anzuzeigen.
- `finish_match()`-Ablehnungen (falsche Rolle, Match bereits `finished`, kein
  eindeutiger Gewinner laut Sätzen) kommen als Fehlermeldung vom Server
  zurück und werden inline angezeigt — gleiches Muster wie in Teilprojekt 1/2.
- Regenerierung mit vorhandenen `live`/`finished`-Matches wird serverseitig
  durch die bestehende `on delete restrict`-Kette bzw. eine explizite
  Prüfung vor dem Löschen verhindert, nicht nur clientseitig.

## Testing

- **RPC/RLS-Tests** (`node --test` gegen lokalen Supabase-Stack):
  `finish_match` — Gewinnerberechnung bei regulärem Ende und bei
  Hard-Cap-Sätzen, Ablehnung bei nicht eindeutigem Ergebnis, Erfolg sowohl aus
  `status = 'scheduled'` als auch `status = 'live'`, Ablehnung bei bereits
  `status = 'finished'`, Auflösung eines abhängigen Matches (Sieger- und
  Verlierer-Fall), Override-Pfad (Finish ohne vollständigen Satzstand mit
  `p_winner_team_id_override`, inklusive Ablehnung eines Override-Werts, der
  keines der beiden Match-Teams ist), Bestätigung dass Admin
  `status = 'finished'` nicht mehr direkt per `UPDATE` setzen kann.
- **Unit-Tests** für die clientseitige Paarungs-/Slot-Berechnung (reine
  Funktion, kein Supabase nötig): gerade/ungerade Teamzahl, Kollisionsprüfung
  gegen bereits belegte Courts/Zeiten, Fehlerfall bei zu wenig Slots.
- **Playwright-Smoke-Test**: eine Kategorie mit 4 Teams anlegen, Gruppenphase
  generieren, Vorschau prüfen, anlegen bestätigen, ein KO-Match mit
  "Sieger von Match #X"-Quelle anlegen, das Quell-Match durchspielen und
  finishen, prüfen dass das KO-Match automatisch das richtige Team bekommt.

## Out of Scope (diese Spec)

- Automatische Zuordnung von Gruppenplatzierungen in die erste KO-Runde
  (z. B. "Gruppe A Platz 1 vs. Gruppe B Platz 2") — bleibt manueller
  Admin-Schritt wie heute, da das Muster pro Kategorie/Reglement variiert und
  eine Standings-Berechnung voraussetzt, die erst Teilprojekt 5 baut.
- Automatische Court-/Zeit-Zuteilung für KO-/Platzierungs-Matches — bleibt
  manuell.
- Mehrstufige automatische Kettenauflösung über mehrere KO-Runden hinweg
  ohne dazwischenliegendes echtes Spiel.
- Berücksichtigung von Ruhezeiten zwischen Matches desselben Teams,
  Schiedsrichter-Verfügbarkeit oder anderen Logistik-Constraints im
  Slot-Algorithmus — nur reine Court-/Zeit-Kollisionsfreiheit.
- Änderungen am bestehenden Google-Sheets-basierten `fistball-live`-Viewer
  (bleibt Teilprojekt 5).
