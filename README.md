# Avenier Epi Graf

Webová aplikace (React + Vite, bez backendu) pro rychlou tvorbu epidemiologických grafů pro web Avenier:
sloupcové, vodorovné sloupcové, spojnicové a koláčové grafy s editorem dat, živým náhledem,
exportem do PNG/PDF a vkládáním do článků přes `iframe`.

Podrobný popis architektury, stavu a doporučených kroků: [`docs/STAV-A-UKLID-2026-10.md`](docs/STAV-A-UKLID-2026-10.md).

## Rychlý start

```bash
npm ci          # Node 20+ (testováno na Node 22)
npm run dev     # http://127.0.0.1:5174
npm test        # unit testy utilit (node:test, bez dalších závislostí)
npm run build   # produkční build do dist/
npm run preview
```

## Co aplikace umí

- **Zdroje dat:** ruční zadání (dvojice „název hodnota“, CSV/TSV se středníkem/čárkou/tabulátorem, JSON),
  nahrání `.csv/.tsv/.xlsx/.xls`, import ročních PDF tabulek ÚZIS/SZÚ (parser přes `pdfjs-dist`).
- **Typy grafů:** `bar`, `hbar`, `line`, `pie` (vykreslení vlastním SVG + d3 helpery).
- **Úpravy:** barevná schémata Avenier, vlastní barvy, řazení, rychlé filtry, referenční čára, popisky os,
  české skloňování jednotek (případ/případy/případů …), historie úprav (undo) a uložené snapshoty v `localStorage`.
- **Export:** PNG (`html-to-image`) a PDF (`jsPDF`) s předvolbami (kompletní report / rychlý náhled / prezentace).
- **Embed:** konfigurace grafu se zakóduje do URL (`?mode=embed&variant=…&cfg=<base64url JSON>`),
  takže vložený graf nepotřebuje žádný server ani databázi.

## Struktura

```
src/
  App.jsx               – celá aplikace (UI, stav, grafy, export, embed) – ~2 300 řádků
  main.jsx              – vstupní bod
  styles.css            – styly
  utils/czech.js        – formátování čísel a skloňování
  utils/embed.js        – (de)kódování konfigurace do URL
  utils/importers.js    – parsování textu, tabulek a PDF ÚZIS
tests/utils.test.js     – testy utilit
data/                   – ukázkové PDF tabulky SZÚ (leden, únor 2026) pro ruční test importu
public/logo.png         – logo / favicon
```

## Nasazení (Netlify)

`netlify.toml` nastavuje `npm run build` → `dist` a SPA redirect. Pro subdoménu (např. `epi-graf.avenier.cz`)
stačí v Netlify přidat custom doménu a CNAME v DNS. Při nasazení do podsložky nastav `base` ve `vite.config.js`.
