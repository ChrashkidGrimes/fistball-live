# Faustball EMS — Teilprojekt 7: Viewer-Refactor + Politur

**Datum:** 2026-07-04
**Status:** approved (Design), pending spec review

## Kontext

Der öffentliche Viewer (`index.html`, `app.js`, `styles.css`, `sw.js`)
liest seit Teilprojekt 5 von Supabase. Die Optik entspricht bereits der
Referenz (https://c-englert.github.io/fistball-live/ — `styles.css` ist
identisch). `app.js` ist aber mit 795 Zeilen eine einzige Datei, die
State, Standings-Berechnung, vier Render-Bereiche, Datenladen und
PWA-Logik mischt. Die Standings-/Tiebreaker-Logik ist pur, hat aber
keine Unit-Tests (nur die Mapping-Schicht `data-mapping.js` ist
getestet).

## Ziel dieses Teilprojekts

1. `app.js` in fokussierte ES-Module zerlegen — **ohne
   Verhaltensänderung**. Die Standings-Logik wird dabei pur extrahiert
   und bekommt Unit-Tests.
2. UX-Politur im bestehenden Design: Skeleton-Loader, einheitliche
   Leere-Zustände, Barrierefreiheit, bessere mobile Navigation, sanfte
   View-Übergänge.
3. Sicherheits-Härtung: vendored Supabase-Client statt esm.sh-CDN
   (Vendor-Datei entsteht in Teilprojekt 6), Content-Security-Policy,
   Escaping-Audit, robustes Parsen der `localStorage`-Caches.

Teilprojekt 8 (Live-Tab, Spieldetails, Ticker) baut auf der neuen
Modulstruktur auf und ist bewusst getrennt.

## Architektur — Modulaufteilung

`index.html` lädt weiterhin nur `<script type="module" src="app.js">`.
Neue Struktur (neues Verzeichnis `js/`):

- `js/state.js` — zentrales `state`-Objekt, `localStorage`-Persistenz
  (`fb_category`, `fb_view`, `fb_cross`, `fb_cache`, `fb_rules`,
  `fb_cautions`) hinter kleinen Funktionen (`persist(key, value)`,
  `restore(key)`), `CONFIG`, `GROUP_ROUNDS`, `CATEGORY_ORDER`.
- `js/standings.js` — **pure Logik ohne DOM**: `matchPointsFor`,
  `aggregate`, `criterionValues`, `breakTies`, `computeStandings`,
  `groupTeams`, `headToHead`, `knockoutMatches`, `knockoutStage`.
  Nimmt Matches/Regeln als Parameter (kein Zugriff auf `state`),
  damit sie testbar ist.
- `js/meta.js` — kleine Helfer: `FLAGS`, `CODES`, `codeFor`, `flagFor`,
  `genderOf`, `orderIndex`, `esc`, `statusClass`, `isFinished`,
  `isLive`.
- `js/views/standings-view.js` — `renderStandings`, `renderCrossTable`.
- `js/views/bracket-view.js` — `renderBracket`, `renderKnockout`,
  `bracketNode`.
- `js/views/matches-view.js` — `renderMatches`, `renderMatchFilter`,
  `matchCard` (Export — wird auch vom Bracket für Platzierungsrunden
  genutzt).
- `js/views/cards-view.js` — `renderCards`, `cautionBadge`.
- `js/pwa.js` — Install-Prompt, Service-Worker-Registrierung,
  Update-Toast (`showUpdateToast`).
- `app.js` (Root, bleibt Entry) — Boot, `load()`/`applyData()`/
  `cacheData()`/`showBanner()`, `renderCategories`, View-Switching
  (`setView`, `setCategory`, `renderActiveView`), Verdrahtung der
  Header-Buttons, Refresh-Intervall.

Regeln für den Schnitt:

- Reines Verschieben + Import/Export — keine Umbenennungen, keine
  Logik-Änderungen in diesem Schritt (Review-bar als „Move").
- Zirkularität vermeiden: Views importieren aus `state`/`standings`/
  `meta`, nie umgekehrt; `app.js` importiert alles und reicht
  Callbacks (z. B. Re-Render bei Chip-Klick) explizit weiter.
- `sw.js`: alle neuen `js/`-Dateien und der vendored Supabase-Client
  in die `SHELL`-Liste, neue Cache-`VERSION`, damit Bestandsclients
  das Update ziehen.

## Sicherheits-Härtung

- **Vendored Supabase-Client:** `supabase-client.js` (Root) importiert
  statt `https://esm.sh/@supabase/supabase-js@2` die in Teilprojekt 6
  erzeugte, gepinnte Vendor-Datei (`vendor/supabase-js-2.110.0.mjs`).
  Damit verschwindet die Laufzeit-Abhängigkeit von fremder
  CDN-Infrastruktur — und weil die Datei same-origin ist, cacht der
  Service Worker sie mit: **die PWA funktioniert damit erstmals
  wirklich offline** (heute scheitert der Cross-Origin-Modul-Import
  ohne Netz, und die App startet gar nicht).
- **Content-Security-Policy (Viewer):** `index.html` bekommt eine
  Meta-CSP analog zum Admin: `default-src 'self'; connect-src 'self'
  https://<projekt-ref>.supabase.co; img-src 'self' data:;
  style-src 'self'; base-uri 'none'; object-src 'none'`.
  Voraussetzung: keine Inline-Skripte/-Styles in `index.html`
  (wird im Zuge des Modul-Schnitts sichergestellt).
- **Escaping-Audit (Viewer):** Durchgang aller Template-Strings in den
  neuen View-Modulen; bekannte Lücke: `matchCard` interpoliert
  `m.nr` unescaped (`#${m.nr}` — kommt aus `sheet_match_nr` bzw.
  synthetischer Kennung). Regel: alles, was aus der DB oder dem
  `localStorage`-Cache stammt, läuft durch `esc()`.
- **Robustes Cache-Parsen:** alle `JSON.parse`-Aufrufe auf
  `localStorage`-Werte laufen über einen gemeinsamen
  `restore()`-Helfer in `js/state.js` mit try/catch + Fallback —
  heute crasht z. B. ein korrupter `fb_rules`-Wert den
  Offline-Fehlerpfad von `load()` (Parse im `catch` ohne Schutz).
- **`sw.js`-Bereinigung:** die tote docs.google.com-Ausnahme fliegt
  raus; Supabase-Antworten bleiben wie bisher ungecacht
  (cross-origin, nur same-origin-GETs landen im Cache).

## Unit-Tests (neu)

`js/standings.test.mjs` (läuft in `test:unit` mit): Fixture-Matches
für eine kleine Gruppe, Abdeckung von

- Punktevergabe über die Point-Table inkl. Fallback-Zeile,
- Draw-Handling,
- Tiebreaker-Kette inkl. Head-to-head-Untergruppen-Neustart
  (der `breakTies`-Rekursionsfall),
- `computeStandings`-Ende-zu-Ende (Reihenfolge + Zeilenwerte),
- `knockoutStage`-Klassifizierung der bekannten Runden-Labels.

Die Tests entstehen unmittelbar mit der Extraktion von
`js/standings.js` (das heutige `app.js` ist nicht importierbar, da es
beim Laden DOM-Code ausführt). Verhaltens-Anker: Die Extraktion ist
ein reiner Move (Diff-Review), und die Fixture-Erwartungswerte werden
vorab von Hand bzw. gegen die live berechneten Produktions-Standings
verifiziert.

## UX-Politur

- **Skeletons:** Beim Erstladen ohne Cache zeigen Standings/Matches
  Platzhalter-Blöcke (Tabellenzeilen/Karten als schimmernde Flächen,
  CSS-Animation) statt des reinen „Loading…"-Texts. Sobald Daten da
  sind (auch aus dem Cache), verschwinden sie — der heutige
  Instant-Paint aus `fb_cache` bleibt unverändert.
- **Leere-Zustände:** bestehende `.empty`-Texte behalten, einheitlich
  mit dezentem Icon versehen.
- **A11y:**
  - View-Tabs: `role="tablist"`/`role="tab"`, `aria-selected`,
    Pfeiltasten-Navigation nicht nötig (echte Buttons bleiben).
  - Kategorie-Pills und Filter-Chips: `aria-pressed`.
  - `:focus-visible`-Ringe für alle interaktiven Elemente.
  - `prefers-reduced-motion`: Puls-/Schimmer-/Übergangs-Animationen
    deaktivieren.
  - Kontrast: `--muted` (#93a2c0 auf #0b1220 ≈ 7:1) ist ok; geprüft
    werden die kleineren Fälle mit `opacity` (`.event-sub`,
    Tag-Texte) und ggf. auf volle Deckkraft/hellere Farbe angehoben.
- **Navigation mobil:**
  - View-Tabs werden sticky direkt unter dem Header (Kategorie-Pills
    scrollen weg, Tabs bleiben).
  - Kategorie-Pill-Reihen: horizontales Scrollen mit
    `scroll-snap-type`, aktive Pill wird bei Auswahl/Boot per
    `scrollIntoView({ inline: 'nearest' })` sichtbar gehalten.
- **View-Übergänge:** kurzes Fade-in (~120 ms) beim Tab-Wechsel,
  CSS-only, unter `prefers-reduced-motion` aus.

## Testing

- Neue Standings-Unit-Tests (siehe oben) in `test:unit`; dazu kleine
  Tests für den `restore()`-Helfer (korrupter/fehlender Wert →
  Fallback statt Exception).
- Bestehende `data-mapping`-Tests bleiben unverändert grün.
- Kein Playwright für den Viewer (weiterhin keine
  E2E-Infrastruktur dafür; der Refactor ist durch die Unit-Tests
  verankert).
- **Manuell:** Smoke-Test aller 4 Views mit Produktionsdaten
  (Desktop + ~390 px), Offline-Fallback (Netz kappen → App startet
  jetzt auch offline vollständig, Banner + Cache-Daten), SW-Update-
  Toast (Version hochzählen), Browser-Konsole ohne CSP-Verstöße.

## Out of Scope (diese Spec)

- Keine neuen Features (Live-Tab, Spieldetails, Court-Ansicht →
  Teilprojekt 8).
- Keine Änderung an Datenladen, Polling-Intervall, Supabase-Queries
  oder `data-mapping.js` (einzige Ausnahme: der Import in
  `supabase-client.js` wechselt auf die Vendor-Datei).
- Kein Bundler/Build-Schritt — es bleiben native ES-Module.
- Keine Farb-/Layout-Redesigns — die Referenz-Optik bleibt.
