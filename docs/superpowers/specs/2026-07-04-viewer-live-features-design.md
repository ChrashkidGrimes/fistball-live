# Faustball EMS — Teilprojekt 8: Viewer Live-Tab, Spieldetails & Ticker

**Datum:** 2026-07-04
**Status:** approved (Design), pending spec review

## Kontext

Nach Teilprojekt 7 ist der Viewer in Module zerlegt (`js/state.js`,
`js/standings.js`, `js/meta.js`, `js/views/*`, `js/pwa.js`) und poliert.
Dieses Teilprojekt setzt die neuen Zuschauer-Features darauf. Die
UI-Sprache bleibt Englisch (internationales Publikum), das Design bleibt
das bestehende dunkle Referenz-Design.

**Voraussetzung:** Teilprojekt 7 ist gemergt.

## Ziel dieses Teilprojekts

1. **Live-Tab** — neuer 5. Tab, kategorieübergreifend: laufende Spiele
   + nächste Spiele, wahlweise nach Zeit oder nach Court gruppiert
   (Court-Ansicht für die Halle).
2. **Spieldetails** — Tippen auf eine Match-Karte öffnet ein
   Bottom-Sheet mit Satzdetails, Meta-Infos und Karten des Spiels.
3. **Live-Ticker-Gefühl** — Live-Gruppe zuoberst im Matches-Tab,
   Score-Puls bei Änderungen, Live-Indikator am Tab.

## Feature 1: Live-Tab

- Neuer Tab „Live" **links vor** Standings in der View-Tab-Leiste;
  neues View-Modul `js/views/live-view.js`, neuer View-Container in
  `index.html`.
- **Startansicht:** Für Erstbesucher (kein `fb_view` in
  `localStorage`) ist Live der Default. Bestandsbesucher behalten
  ihre persistierte View.
- Die Kategorie-Pills werden im Live-Tab ausgeblendet (der Tab ist
  bewusst kategorieübergreifend); beim Wechsel zurück auf andere Tabs
  erscheinen sie wieder.
- **Modus „By time" (Default):**
  - Sektion **„Live now"**: alle Spiele mit `isLive()` über alle
    Kategorien, als bestehende `matchCard`s, ergänzt um ein
    Kategorie-Badge (die Karte zeigt sonst keine Kategorie). Leer →
    Sektion wird ausgeblendet.
  - Sektion **„Up next"**: die nächsten 6 Spiele mit Status
    `Not Started` in `scheduled_time`-Reihenfolge (die Match-Liste
    ist bereits so sortiert), ebenfalls mit Kategorie-Badge.
  - Beide leer → Leere-Zustand („No live or upcoming matches right
    now — see Matches for full results.").
- **Modus „By court":** Toggle-Chips „By time | By court" (Muster
  Sets/Points-Toggle, persistiert als `fb_live_mode`). Pro Court eine
  Sektion (Sortierung nach Court-Name): das laufende Spiel des Courts
  plus dessen nächste 2 anstehende Spiele. Spiele ohne Court (KO-Slots
  o. Ä.) erscheinen in einer Sektion „No court assigned" am Ende, nur
  falls vorhanden.
- Das Kategorie-Badge auf den Karten wird als Option von `matchCard`
  implementiert (`matchCard(m, { showCategory: true })`) — kein
  zweiter Karten-Renderer.

## Feature 2: Spieldetails (Bottom-Sheet)

- Neues Modul `js/match-detail.js` + ein wiederverwendbarer
  Sheet-Container in `index.html` (ein `<div>` am Body-Ende,
  Backdrop + Panel, auf Desktop zentriertes Modal, auf Handy von
  unten einfahrend).
- **Öffnen:** Tap/Klick auf eine Match-Karte in Live-, Matches- und
  Bracket-Platzierungslisten (alles, was `matchCard` rendert; die
  kompakten `bmatch`-Baum-Knoten im Bracket bleiben ohne Klick —
  zu kleine Ziele). `matchCard` bekommt dafür `data-match-id`;
  ein Delegations-Listener auf den View-Containern öffnet das Sheet.
  Die Karte wird per `role="button"`/`tabindex="0"` auch
  Tastatur-bedienbar (Enter/Space).
- **Inhalt:**
  - Kopf: Kategorie, Runde, Status-Badge, `#nr`.
  - Teams groß mit Flaggen und Satz-Gesamtstand.
  - Satz-für-Satz-Tabelle aus `m.sets` (Satz 1…n, Punkte beider
    Teams, gewonnener Satz markiert).
  - Meta-Zeile: Tag, Zeit, Court.
  - **Karten des Spiels:** aus `state.cautions` gefiltert — die
    `events` der Cautions tragen die Match-Referenz aus
    `player_events` (Feld wird in `data-mapping.js` um die
    `match_id` ergänzt, die die Query bereits lädt). Zeigt
    Spielername, Team, Kartentyp. Keine Karten → Zeile entfällt.
  - **Schiedsrichter (bedingt):** Zu Beginn der Umsetzung wird
    geprüft, ob `referee_assignments` (+ `referees`-Namen) für die
    `anon`-Rolle lesbar ist. Falls ja: eine zusätzliche Query im
    bestehenden `load()`-Zyklus (ein Fetch pro Refresh für alle
    Matches, kein Fetch pro Sheet-Öffnung), Anzeige als Meta-Zeile
    „Referees: …". Falls nein: Zeile entfällt ersatzlos —
    **kein RLS-Umbau in diesem Teilprojekt**.
- **Schließen:** Backdrop-Tap, ✕-Button, ESC. Fokus geht beim Öffnen
  auf das Sheet, beim Schließen zurück auf die auslösende Karte.
  Hintergrund scrollt nicht mit (`overflow: hidden` auf `body`,
  solange offen). Beim 60s-Refresh mit offenem Sheet wird dessen
  Inhalt aus dem neuen State neu gerendert (Match per Id
  wiedergefunden; verschwindet es, schließt das Sheet).

## Feature 3: Live-Ticker-Gefühl

- **Matches-Tab:** Vor den Tagesgruppen erscheint eine Gruppe
  „Live" mit allen laufenden Spielen der aktiven Kategorie (sie
  bleiben zusätzlich in ihrer Tagesgruppe — die Live-Gruppe ist eine
  Hervorhebung, keine Umsortierung; Karten dort ohne Duplikat-Logik
  schlicht erneut gerendert).
- **Score-Puls:** `applyData()` vergleicht vor dem Ersetzen des
  States alt/neu pro Match-Id (`setsA/B`, `pointsA/B`, Status).
  Geänderte Ids werden gesammelt; nach dem Re-Render bekommen deren
  Karten einmalig eine CSS-Klasse (`.scored`), die kurz Hintergrund/
  Border pulsiert (~1,2 s, dann entfernt). Unter
  `prefers-reduced-motion` entfällt die Animation.
- **Live-Indikator am Tab:** Der Live-Tab zeigt einen kleinen
  pulsierenden Punkt (Muster `.live-dot`), solange mindestens ein
  Spiel läuft — sichtbar aus jedem anderen Tab.

## Datenfluss

Keine Änderung am Polling (60 s + Sichtbarkeits-Refresh). Einzige
mögliche neue Query: Referee-Zuweisungen (siehe oben, bedingt).
`data-mapping.js` wird minimal erweitert (Match-Id in
Caution-Events); `mapMatch` bleibt unverändert.

## Testing

- **Unit-Tests** (`node --test`, in `test:unit`):
  - Auswahl-Logik des Live-Tabs als pure Funktionen in
    `js/live-select.js`: `selectLive(matches)`,
    `selectUpNext(matches, n)`, `groupByCourt(matches)` —
    Fixtures mit live/scheduled/finished, Courts, ohne Court.
  - Diff-Funktion des Score-Pulses (`changedMatchIds(old, new)`).
  - Erweiterung der `data-mapping`-Tests um die Match-Id in
    Caution-Events.
- **Manuell:** Live-Tab in beiden Modi mit Produktionsdaten,
  Sheet öffnen/schließen (Handy + Desktop, Tastatur), Score-Puls
  durch echtes Live-Scoring im Admin auslösen, Erstbesuch im
  Inkognito-Fenster (Live als Default-View).
- `sw.js`: neue Dateien in `SHELL`, Version hochzählen.

## Out of Scope (diese Spec)

- Punkt-für-Punkt-Liveticker innerhalb eines Satzes (bleibt intern).
- Push-Benachrichtigungen.
- Supabase-Realtime (Polling bleibt).
- RLS-Änderungen (Referee-Anzeige nur, wenn bereits lesbar).
- Klickbare Bracket-Baum-Knoten (nur Karten-Layouts öffnen Details).
