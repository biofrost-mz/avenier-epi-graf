# Avenier Epi Graf – stav, analýza a úklid (říjen 2026)

## Shrnutí

| | |
|---|---|
| Účel | Generátor epidemiologických grafů pro články Avenier (PNG/PDF/iframe) |
| Stack | React 18, Vite 5, d3 7, jsPDF, html-to-image, pdfjs-dist 5, SheetJS (xlsx 0.18.5) |
| Backend | žádný – stav v `localStorage`, embed konfigurace v URL |
| Hosting | Netlify (`netlify.toml`) |
| Viditelnost repa | **veřejné** |
| Historie | 1 commit (březen 2026), od té doby bez vývoje |
| Příbuzné repo | `mapy-nemoci` (stejný stack, mapa krajů) – sdílí logo, paletu i postup embedu |

## Architektura

- `App.jsx` obsahuje vše: konfigurace palet a předvoleb, komponenty grafů (`BarChart`, `HorizontalBarChart`,
  `LineChart`, `PieChart`), modaly (export, embed, nový graf), správu historie a snapshotů.
- Režimy podle URL: běžný editor, `?mode=embed` (jen graf), varianty embedu (`variant=`).
- Import PDF: `parseUzisYearlyPdf` čte textové vrstvy PDF a skládá tabulku diagnóz × měsíců;
  z ní `buildTopDiagnosisRows` (TOP diagnózy za rok) a `buildDiagnosisTimelineRows` (vývoj jedné diagnózy).

## Provedený úklid (větev `claude/awesome-ride-6kb6m0`)

- `xlsx` se načítá dynamicky až při importu tabulky → hlavní JS bundle zmenšen z ~995 kB na ~660 kB.
- `npm audit fix` (fflate a další tranzitivní závislosti, bez breaking změn).
- Přidány unit testy utilit (`npm test`, `node:test` – žádná nová závislost).
- Smazán nepoužívaný `public/favicon.ico` (byl to jen PNG kopie `logo.png`; favicon je `logo.png`).
- `.gitignore` zbaven zbytků po lokálních testech (`root-write.txt`, `package 2.json`, …).
- Přepsán README (funkce, struktura, testy).

## Zjištěná rizika a dluh

1. **SheetJS `xlsx@0.18.5` má známé zranitelnosti** (prototype pollution, ReDoS) a na npm už se neopravuje.
   Riziko je nízké (soubory nahrává sám redaktor), ale doporučená náprava je přechod na oficiální build
   `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (v této cloud session byl CDN nedostupný).
2. `App.jsx` má ~2 300 řádků – pro další vývoj rozdělit na `components/` (grafy, modaly) a `hooks/`.
3. Export: jsPDF a html-to-image se načítají až při exportu (hlavní bundle ~256 kB); PDF je komprimované (graf ~230 kB místo ~15 MB).
4. CI (GitHub Actions: testy + build) přidáno; lint chybí.
5. Data PDF v `data/` jsou veřejná data SZÚ – v pořádku, ale zvětšují repo (2,6 MB).

## Úkoly pro vlastníka

- [ ] Rozhodnout, zda je aplikace v provozu (Netlify) a zda má smysl ji dál rozvíjet, nebo repo archivovat.
- [ ] Mergnout větev `claude/awesome-ride-6kb6m0` do `main`.
- [ ] Nahradit `xlsx` za CDN build SheetJS (`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`).
