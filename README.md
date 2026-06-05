# MPC ⇄ Ableton Drum Rack — wersja web

Konwerter działający **w całości w przeglądarce** (JavaScript). Obie strony:

- **Ableton → MPC**: `.adg` (Drum Rack Live 12) → `.xpm` (program MPC 3) + sample
- **MPC → Ableton**: `.xpm` (program MPC) → `.adg` (Drum Rack Live 12) + sample

Bez serwera, bez Pythona, bez node. Pliki **nie wychodzą** z komputera — cała konwersja lokalnie. Po załadowaniu strony działa też offline.

## Co przenosi

- Układ padów 1:1 (w tym kity zrobione forward-toolem — wykrywa i odwraca mapowanie, zachowując luki)
- Chopy sampla (Sample Start/End ↔ Slice)
- Głośność (dB, krzywa fadera MPC `40·log10(v)+6`), pan, choke ↔ mute group
- Wynik jako `.zip` z folderem kitu (`.xpm`/`.adg` + skopiowane WAV-y)

## Użycie

1. Wybierz kierunek (zakładka u góry)
2. Upuść plik `.adg`/`.xpm`
3. Upuść folder z samplami WAV (albo zaznacz pliki)
4. **Konwertuj** → pobierz `.zip`, rozpakuj, wrzuć na MPC / do Live

Działa też lokalnie: otwórz `index.html` w przeglądarce (Chrome / Safari / Firefox aktualne — wymaga `CompressionStream`).

## Pliki

```
index.html     — UI + logika sklejająca
app.js         — silnik konwersji (obie strony, ZIP, gzip, parsowanie WAV)
templates.js   — szablony MPC3/Ableton osadzone jako stringi
```

`app.js` jest też testowalny w Node 22 (`require('./templates.js'); require('./app.js')` → `globalThis.MPCWEB`).

## Wdrożenie na Cloudflare Pages

**Metoda A — Direct Upload (bez narzędzi):**
1. Dashboard Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Przeciągnij cały ten folder (`index.html`, `app.js`, `templates.js`)
3. Deploy → dostajesz adres `*.pages.dev`

**Metoda B — z GitHuba (auto-deploy):**
1. **Create** → **Pages** → **Connect to Git** → wybierz to repo
2. Framework preset: **None**, Build command: *(puste)*, Output dir: `/`
3. Save and Deploy

To statyczna strona — Cloudflare nic nie buduje, tylko serwuje pliki.

## Licencja

MIT.
