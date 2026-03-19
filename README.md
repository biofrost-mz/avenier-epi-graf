# Avenier Epi Graf

Webova aplikace pro rychle vytvareni:
- sloupcovych grafu
- kolacovych grafu

Aplikace obsahuje editor dat, zivy nahled a export do PNG/PDF.

## Lokalni spusteni

```bash
npm install
npm run dev
```

Vychozi URL: `http://127.0.0.1:5174`

## Build

```bash
npm run build
npm run preview
```

## Nasazeni na subdomenu (Netlify)

Projekt je pripraveny pres `netlify.toml`.

1. Propoj repozitar do Netlify.
2. Nastav custom domenu/subdomenu (napr. `epi-graf.avenier.cz`).
3. U domeny nastav DNS zaznam podle instrukci Netlify (nejcasteji `CNAME`).
4. Over, ze build command je `npm run build` a publish folder `dist`.

Pokud bude aplikace nasazena do podslozky (ne jako subdomena), nastav `base` ve `vite.config.js`.
