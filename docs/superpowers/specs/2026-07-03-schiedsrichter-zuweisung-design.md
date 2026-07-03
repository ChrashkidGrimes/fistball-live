# Faustball EMS — Teilprojekt 4: Schiedsrichter-Zuweisung

**Datum:** 2026-07-03
**Status:** approved (Design), pending spec review

## Kontext

Teilprojekt 1 (Fundament), Teilprojekt 2 (Digitale Sumula / Game Report) und
Teilprojekt 3 (Spielplan-Generator) sind abgeschlossen und in `main`
gemergt. Die `referee_assignments`-Tabelle existiert bereits seit
Teilprojekt 1 (`match_id`, `referee_name` als Freitext, `role` als Freitext
— bewusst kein festes Enum, da die realen Rollen aus dem offiziellen
Game-Report-Formular variieren: "1st Referee", "2nd Referee", "Recording
Clerk", "Assistant Referee 1", "Assistant Referee 2"). Bisher gibt es dafür
nur eine Lese-Anzeige im Game-Report-Screen (Teilprojekt 2) — kein
Schreib-UI. Eine Prüfung der Produktionsdaten zeigt **0 Zeilen** in
`referee_assignments` — dieses Teilprojekt ist vollständig grüne Wiese, es
gibt keine Bestandsdaten zu migrieren.

## Ziel dieses Teilprojekts

Ein neuer **"Schiedsrichter"-Screen** in der Admin-App mit vier Teilen:
Stammdatenverwaltung für Schiedsrichter, manuelle Zuweisung pro Match,
automatische Zuteilung mit Regelwerk (Vorschau + Bestätigung, analog zum
Spielplan-Generator), und eine Workload-Übersicht.

## Datenmodell

Neue Tabelle:

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `referees` | Schiedsrichter-Stammdaten pro Turnier | `tournament_id`, `name`, `country`, `available_from` (nullable `date`), `available_to` (nullable `date`) |

`unique (tournament_id, name)` — analog zum bestehenden Muster bei `courts`
und `teams`. `available_from`/`available_to` sind beide `null` im
Normalfall (Schiedsrichter ist während des gesamten Turniers verfügbar);
sind sie gesetzt, muss das jeweilige Match-Datum innerhalb dieses
(inklusiven) Bereichs liegen, damit der automatische Generator diesen
Schiedsrichter berücksichtigt.

**Umbau der bestehenden `referee_assignments`-Tabelle** (statt einer
zusätzlichen Spalte, da 0 Produktionszeilen betroffen sind — sauberer
Schnitt ohne Backfill-Bedarf):

- `referee_name text not null` wird ersetzt durch
  `referee_id uuid not null references referees(id) on delete restrict`
  (verhindert stillen Verlust von Zuweisungshistorie, gleiches Muster wie
  `players`/`substitutions` aus Teilprojekt 2).
- `role text not null` bleibt unverändert (Freitext, kein Enum).

**Doppelbuchungs-Schutz als Trigger, nicht als RPC:** ein
`before insert or update`-Trigger auf `referee_assignments` lehnt eine
Zuweisung hart ab, wenn derselbe `referee_id` bereits eine andere
`referee_assignments`-Zeile hat, deren zugehöriges Match dieselbe
`matches.scheduled_time` besitzt (Matches ohne `scheduled_time` können per
Definition nicht kollidieren und werden übersprungen). Anders als bei
`finish_match` aus Teilprojekt 3 gibt es hier keinen legitimen
Umgehungspfad — die bestehende `admin write referee_assignments`-Policy aus
Teilprojekt 1 bleibt unverändert, der Trigger reicht als alleinige
Durchsetzung.

## Automatische Zuteilung — Algorithmus

Reine, client-seitige Funktion (kein RPC, keine Rollenprüfung nötig, analog
zu `admin/schedule-generator.js` aus Teilprojekt 3) — nur das tatsächliche
Schreiben der ausgewählten Zuweisungen läuft über die bestehende,
rollengeprüfte `INSERT`-Policy auf `referee_assignments`.

**Eingaben:** die zu befüllenden Matches (chronologisch nach
`scheduled_time` sortiert), die gewählten Rollen (Teilmenge der 5 bekannten
Rollen), der verfügbare `referees`-Pool des Turniers, bereits bestehende
Zuweisungen (für Lastzählung und Kollisionsprüfung).

**Ablauf:** für jedes Match und jede gewählte, in diesem Match noch nicht
belegte Rolle wird ein Schiedsrichter gesucht:

1. **Harte Ausschlusskriterien** (Schiedsrichter scheidet für diesen
   Rollen-Slot komplett aus):
   - bereits einem anderen Match mit identischer `scheduled_time`
     zugewiesen (spiegelt den DB-Trigger client-seitig, damit die Vorschau
     nicht mit einem harten Serverfehler abbricht, sondern den Slot sauber
     als "nicht zuteilbar" meldet),
   - außerhalb von `available_from`/`available_to`, falls gesetzt,
   - bereits eine andere Rolle in genau diesem Match.
2. **Weiche Kriterien** (fließen als Score-Malus ein, schließen aber nicht
   aus):
   - `country` des Schiedsrichters entspricht `team_a.name` oder
     `team_b.name` des Matches **und** die gesuchte Rolle ist
     `"1st Referee"` (Vergleich case-insensitiv; gilt bewusst nur für diese
     eine Rolle, nicht für alle). Hat das Match (noch unaufgelöste
     KO-Platzhalter aus Teilprojekt 3, `team_a_id`/`team_b_id` ist `null`)
     kein festes Team auf einer oder beiden Seiten, entfällt dieser
     Malus für die betroffene(n) Seite(n) ersatzlos — kein Fehler, keine
     Warnung, einfach nichts zu vergleichen,
   - der Schiedsrichter hatte im unmittelbar vorhergehenden Zeit-Slot
     (nächst-frühere `scheduled_time` unter allen Matches) bereits eine
     Zuweisung (keine Pause).
3. Unter den verbleibenden, nicht hart ausgeschlossenen Schiedsrichtern
   gewinnt der mit dem niedrigsten Score; bei Score-Gleichstand gewinnt der
   mit der bisher niedrigsten Gesamtzahl an Zuweisungen (inkl. der in
   diesem Lauf bereits vergebenen) — das ist die primäre
   Gleichverteilungs-Regel.
4. Findet sich kein Schiedsrichter ganz ohne harten Ausschlussgrund, bleibt
   der Slot in der Vorschau leer und wird als "nicht zuteilbar" markiert —
   keine Teil-Zuteilung wird verworfen, die übrigen Slots werden trotzdem
   berechnet.

**Vorschau vor dem Schreiben**, wie beim Spielplan-Generator: berechnete
Zuweisungen (Match, Rolle, Schiedsrichter, ggf. Konfliktwarnung) werden
angezeigt, erst ein zweiter Klick schreibt sie per einzelnen `INSERT`s in
`referee_assignments`. Das Ergebnis bleibt danach über die manuelle
Zuweisungs-UI editierbar (einzelne Rollen ändern/löschen) — der Generator
liefert einen Startpunkt, keine Einbahnstraße.

## Zugriffskontrolle

- `referees`: lesend offen für alle Rollen (wie alle Stammdaten-Tabellen),
  Schreiben (`insert`/`update`/`delete`) nur Admin — identisches Muster zu
  `admin write courts`/`admin write teams` aus Teilprojekt 1.
- `referee_assignments`: Zugriffsrechte unverändert aus Teilprojekt 1
  (`public read referee_assignments`, `admin write referee_assignments`).
- Keine neuen Rollen, keine RPCs.

## UI-Scope

Neuer Nav-Punkt **"Schiedsrichter"** mit vier Bereichen:

1. **Stammdaten**: Liste + Anlegen/Bearbeiten pro Turnier (Name, Land,
   optional Verfügbarkeitsfenster von/bis) — analog zum bestehenden
   Teams-Screen.
2. **Manuelle Zuweisung**: Turnier → Kategorie → Match auswählen, aktuelle
   Zuweisungen dieses Matches anzeigen (Rolle, Name, Land) + löschbar,
   neue Zuweisung hinzufügen über Schiedsrichter-Dropdown +
   Rollen-Dropdown (die 5 bekannten Rollen + "Andere" mit Freitextfeld).
   Interessenkonflikt-Warnung (Land des gewählten Schiedsrichters entspricht
   einem der beiden Team-Namen) erscheint inline vor dem Absenden, sobald
   erkennbar — nicht blockierend, und nur wenn beide Teams des Matches
   bereits feste Teams sind (kein unaufgelöster KO-Platzhalter aus
   Teilprojekt 3). Ein serverseitiger Fehler durch den
   Doppelbuchungs-Trigger wird inline wie gewohnt angezeigt.
3. **Automatische Zuteilung**: Kategorie(n) + zu befüllende Rollen wählen,
   "Vorschau berechnen" → Tabelle mit Match/Rolle/Schiedsrichter (leere
   Zeile bei nicht zuteilbaren Slots) → "Anlegen" schreibt die Vorschau.
4. **Workload-Übersicht**: reine Anzeige-Tabelle, eine Zeile pro
   Schiedsrichter (Name, Land, Gesamtanzahl Zuweisungen, eine Spalte pro
   Turniertag mit der jeweiligen Tages-Anzahl) — Turniertag bestimmt aus
   dem Datumsanteil von `matches.scheduled_time`. Zuweisungen zu einem
   Match ohne gesetzte `scheduled_time` zählen in die Gesamtanzahl, aber in
   keine Tages-Spalte (dafür gibt es keinen Tag).

## Fehlerbehandlung

- Der Doppelbuchungs-Trigger meldet einen Fehler, der inline im
  Zuweisungs-Formular angezeigt wird — gleiches Muster wie in Teilprojekt
  1–3 (`errorEl.textContent = err.message`).
- Die automatische Zuteilung schlägt nie hart fehl, sondern markiert nicht
  zuteilbare Slots in der Vorschau — der Admin sieht sofort, wie viele
  Rollen manuell nachgetragen werden müssen.
- Die Interessenkonflikt-Warnung ist rein informativ und verhindert das
  Absenden nicht.

## Testing

- **RLS/Constraint-Tests** (`node --test` gegen lokalen Supabase-Stack):
  FK-Integrität `referees` ↔ `referee_assignments`, `on delete restrict`
  verhindert Löschen eines noch referenzierten Schiedsrichters, der
  Doppelbuchungs-Trigger lehnt eine zweite Zuweisung mit identischer
  `scheduled_time` ab und lässt eine Zuweisung zu einem Match mit anderer
  Zeit zu, `admin write referees`/`referee_assignments`-Policies (Admin
  darf, Scorer/anon dürfen nicht schreiben).
- **Unit-Tests** für die reine Zuteilungs-Funktion (kein Supabase nötig,
  analog zu `admin/schedule-generator.test.mjs`): Gleichverteilung bei
  ausreichend Schiedsrichtern, Eigenland-Vermeidung bei "1st Referee" wenn
  eine Alternative existiert, Verfügbarkeitsfenster wird respektiert, ein
  Schiedsrichter bekommt nie zwei zeitgleiche Zuweisungen, ein leerer
  Slot wird korrekt gemeldet, wenn niemand infrage kommt.
- **Playwright-Smoke-Test**: Schiedsrichter anlegen, manuell einem Match
  zuweisen (inkl. sichtbarer Interessenkonflikt-Warnung bei passendem
  Land), automatische Zuteilung für eine Kategorie laufen lassen und
  bestätigen, Workload-Tabelle zeigt die korrekte Gesamtzahl.

## Out of Scope (diese Spec)

- Eigenland-Regel für andere Rollen als "1st Referee" (z. B. Recording
  Clerk) — bewusst nicht Teil dieser Spec.
- Rollen-Vielfalt als eigenes Zuteilungskriterium (nur Gesamtzahl wird für
  die Gleichverteilung herangezogen, nicht die Verteilung einzelner
  Rollen).
- Zertifizierungslevel/Erfahrung von Schiedsrichtern und darauf basierende
  Zuordnung zu wichtigeren Matches (z. B. Gold-Medal-Match) — kein
  entsprechendes Datenfeld in dieser Spec.
- Court-Distanz/Wegzeiten zwischen aufeinanderfolgenden Einsätzen im
  Zuteilungs-Algorithmus.
- Anzeige der Schiedsrichter-Zuweisungen für die Öffentlichkeit (bleibt
  Teilprojekt 5 — der bestehende `fistball-live`-Viewer liest weiterhin vom
  Google Sheet).
