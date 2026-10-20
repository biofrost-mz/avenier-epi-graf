const PDF_WORKER_SRC = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const LABEL_KEYS = ['label', 'nazev', 'název', 'kategorie', 'diagnoza', 'diagnóza', 'name', 'region']
const VALUE_KEYS = ['value', 'hodnota', 'pocet', 'počet', 'count', 'cases']
const COLOR_KEYS = ['color', 'barva', 'colour']

export function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function detectDelimiter(line) {
  if (line.includes(';')) return ';'
  if (line.includes('\t')) return '\t'
  return ','
}

function parseDelimitedRows(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) return []

  const delimiter = detectDelimiter(lines[0])
  const firstCells = lines[0].split(delimiter).map((h) => h.trim())
  const looksLikeHeader = firstCells.some((cell) => !/^[-+]?\d+(?:[.,]\d+)?$/.test(cell))

  if (!looksLikeHeader && firstCells.length >= 2) {
    return lines.map((line) => {
      const cells = line.split(delimiter).map((cell) => cell.trim())
      return {
        label: cells[0],
        value: cells[1],
        color: cells[2],
      }
    })
  }

  const headers = firstCells

  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter).map((cell) => cell.trim())
    const row = {}
    headers.forEach((header, index) => {
      row[header] = cells[index]
    })
    return row
  })
}

function parseLoosePairs(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) return []

  const rows = []
  for (const line of lines) {
    const pairMatch = line.match(/^(.*?)[\s;,\t]+([-+]?\d+(?:[.,]\d+)?)$/)
    if (!pairMatch) return []

    const label = String(pairMatch[1] ?? '').trim()
    const value = String(pairMatch[2] ?? '').trim()
    if (!label || !value) return []

    rows.push({ label, value })
  }

  return rows
}

export function parseManualText(rawText) {
  const text = String(rawText ?? '').trim()
  if (!text) return []

  if (text.startsWith('{') || text.startsWith('[')) {
    const parsed = JSON.parse(text)

    if (Array.isArray(parsed)) return parsed

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([label, value]) => ({
        label,
        value: typeof value === 'object' ? value?.value : value,
        color: typeof value === 'object' ? value?.color : undefined,
      }))
    }
  }

  const loose = parseLoosePairs(text)
  if (loose.length) return loose

  return parseDelimitedRows(text)
}

export async function parseSpreadsheetFile(file) {
  const buffer = await file.arrayBuffer()
  // SheetJS je velký balík – načítá se až při prvním importu tabulky.
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

export async function parseTabularFile(file) {
  const name = String(file?.name ?? '').toLowerCase()

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseSpreadsheetFile(file)
  }

  const text = await file.text()
  return parseManualText(text)
}

function isNumericLike(value) {
  if (value === '' || value === null || value === undefined) return false
  return parseStrictNumber(value) !== null
}

function parseStrictNumber(value) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.')
  if (!normalized) return null
  const num = Number.parseFloat(normalized)
  return Number.isFinite(num) ? num : null
}

function findFieldKey(row, candidates) {
  const keys = Object.keys(row)
  const normalizedMap = new Map(keys.map((key) => [normalizeText(key), key]))

  for (const candidate of candidates) {
    const key = normalizedMap.get(normalizeText(candidate))
    if (key) return key
  }

  return ''
}

function normalizeColor(value) {
  const str = String(value ?? '').trim()
  if (!str) return null
  if (/^#[0-9a-f]{6}$/i.test(str)) return str
  if (/^#[0-9a-f]{3}$/i.test(str)) return str
  return null
}

export function mapObjectsToChartRows(inputRows, fallbackColors = []) {
  const rows = []

  inputRows.forEach((input, index) => {
    const row = input && typeof input === 'object' ? input : {}

    const labelKey = findFieldKey(row, LABEL_KEYS)
    const valueKey = findFieldKey(row, VALUE_KEYS)
    const colorKey = findFieldKey(row, COLOR_KEYS)

    let label = labelKey ? String(row[labelKey] ?? '').trim() : ''

    if (!label) {
      const firstTextEntry = Object.entries(row).find(([, value]) => {
        const text = String(value ?? '').trim()
        return text && !isNumericLike(text)
      })
      label = String(firstTextEntry?.[1] ?? '').trim()
    }

    let value = valueKey ? parseStrictNumber(row[valueKey]) : null

    if (value === null) {
      const firstNumericEntry = Object.entries(row).find(([key, candidate]) => {
        if (key === labelKey || key === colorKey) return false
        return isNumericLike(candidate)
      })
      value = parseStrictNumber(firstNumericEntry?.[1])
    }

    if (!label || value === null || !Number.isFinite(value)) return

    const colorFromData = colorKey ? normalizeColor(row[colorKey]) : null
    const fallbackColor = fallbackColors[index % Math.max(1, fallbackColors.length)] || '#78be20'

    rows.push({
      label,
      value,
      color: colorFromData || fallbackColor,
    })
  })

  return rows
}

function parseUzisNumber(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/nd\d*/g, '')

  if (!normalized || normalized === '-' || normalized === '.') return null

  const cleaned = normalized.replace(/^>/, '').replace(/[^0-9.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null

  const num = Number(cleaned)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.round(num))
}

function rowText(cols) {
  return cols.map((col) => col.str).join(' ').replace(/\s+/g, ' ').trim()
}

function buildRowsByY(textItems) {
  const rows = new Map()

  for (const item of textItems) {
    const str = String(item.str ?? '').trim()
    if (!str) continue

    const x = Number(item.transform?.[4] ?? 0)
    const y = Number(item.transform?.[5] ?? 0)
    const key = Math.round(y * 10) / 10

    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push({ str, x, y: key })
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cols]) => cols.sort((a, b) => a.x - b.x))
}

function scoreYearlyRow(row) {
  return Object.values(row.values ?? {}).filter((value) => value !== null && value !== undefined).length
}

function extractPeriod(text) {
  const match = text.match(/,\s*([a-zá-ž]+)\s+((?:19|20)\d{2})/i)
  if (!match) return ''
  const month = match[1]
  return `${month.charAt(0).toUpperCase()}${month.slice(1).toLowerCase()} ${match[2]}`
}

function extractYearColumns(cols) {
  const years = cols
    .filter((col) => /^\d{4}$/.test(col.str))
    .map((col) => ({ year: col.str, x: col.x }))
    .sort((a, b) => a.x - b.x)

  return years.length >= 3 ? years : []
}

function cleanDiagnosis(value) {
  return String(value ?? '')
    .replace(/^[†‡*\s)\-|]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseYearlyRowsFromPages(pages) {
  let period = ''
  let title = ''
  let yearColumns = []
  let pendingDiagnosis = ''
  const rows = []

  for (const page of pages) {
    for (const cols of page.rows) {
      if (!cols.length) continue

      const text = rowText(cols)
      if (!title && /Výskyt vybraných hlášených infekcí/i.test(text)) title = text
      if (!period) period = extractPeriod(text)

      const maybeYearColumns = extractYearColumns(cols)
      if (maybeYearColumns.length) {
        yearColumns = maybeYearColumns
        continue
      }

      if (!yearColumns.length) continue

      const codeMatch = text.match(/\b([A-Z]\d{2}(?:\.\d+)?)\b/)
      if (!codeMatch) {
        const canBeDiagnosisLine = /[A-Za-zÁ-ž]/.test(text) && !/^\d{4}/.test(text)
        if (canBeDiagnosisLine && !/^(Kód|Zdroj|Cases|porovnání|compared)/i.test(text)) {
          pendingDiagnosis = cleanDiagnosis(text)
        }
        continue
      }

      const code = codeMatch[1]
      const codeColumn = cols.find((col) => col.str.includes(code))
      const firstYearX = yearColumns[0]?.x ?? Infinity

      const inlineDiagnosis = cleanDiagnosis(
        cols
          .filter((col) => col.x > (codeColumn?.x ?? 0) + 18 && col.x < firstYearX - 6)
          .map((col) => col.str)
          .join(' '),
      )

      let diagnosis = inlineDiagnosis
      if (!diagnosis || /^nd\d*$/i.test(normalizeText(diagnosis))) {
        diagnosis = cleanDiagnosis(pendingDiagnosis)
      }
      pendingDiagnosis = ''

      if (!diagnosis) {
        diagnosis = cleanDiagnosis(text.replace(code, '').replace(/\d+/g, ' '))
      }

      if (!diagnosis) continue

      const values = {}
      yearColumns.forEach((column, index) => {
        const next = yearColumns[index + 1]
        const start = column.x - 6
        const end = next ? next.x - 6 : Infinity
        const cell = cols
          .filter((col) => col.x >= start && col.x < end)
          .map((col) => col.str)
          .join(' ')
          .trim()

        values[column.year] = parseUzisNumber(cell)
      })

      rows.push({
        id: `${code}|${diagnosis}`,
        code,
        diagnosis,
        values,
      })
    }
  }

  const unique = new Map()
  for (const row of rows) {
    const existing = unique.get(row.id)
    if (!existing || scoreYearlyRow(row) > scoreYearlyRow(existing)) {
      unique.set(row.id, row)
    }
  }

  const parsedRows = [...unique.values()]
  const years = yearColumns.map((column) => column.year)

  return {
    format: 'yearly',
    title,
    period,
    years,
    rows: parsedRows,
  }
}

async function loadPdfJsLib() {
  try {
    return await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch {
    return await import('pdfjs-dist/build/pdf.mjs')
  }
}

async function readFileToUint8Array(file) {
  try {
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    const objectUrl = URL.createObjectURL(file)
    try {
      const response = await fetch(objectUrl)
      if (!response.ok) throw new Error(`Soubor se nepodařilo načíst (HTTP ${response.status}).`)
      return new Uint8Array(await response.arrayBuffer())
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

async function readPageTextContent(page) {
  if (typeof page?.streamTextContent === 'function') {
    const stream = page.streamTextContent()
    const reader = stream?.getReader?.()
    if (reader) {
      const textContent = {
        items: [],
        styles: Object.create(null),
        lang: null,
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        if (textContent.lang == null && value.lang) textContent.lang = value.lang
        if (value.styles) Object.assign(textContent.styles, value.styles)
        if (Array.isArray(value.items)) textContent.items.push(...value.items)
      }

      return textContent
    }
  }

  return page.getTextContent()
}

export async function parseUzisYearlyPdf(file) {
  const pdfjsLib = await loadPdfJsLib()
  if (pdfjsLib?.GlobalWorkerOptions && typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC
  }

  const data = await readFileToUint8Array(file)
  const pdf = await pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    stopAtErrors: false,
  }).promise

  const pages = []
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index)
    const text = await readPageTextContent(page)
    pages.push({ page: index, rows: buildRowsByY(text.items) })
  }

  return parseYearlyRowsFromPages(pages)
}

export function buildTopDiagnosisRows(parsedPdf, options = {}) {
  const year = options.year || parsedPdf?.years?.[parsedPdf.years.length - 1]
  const topN = Math.max(1, Number(options.topN || 20))
  const includeZero = Boolean(options.includeZero)

  if (!year) return []

  return (parsedPdf?.rows ?? [])
    .map((row) => ({
      label: `${row.code} ${row.diagnosis}`,
      value: Number(row.values?.[year] ?? 0),
    }))
    .filter((row) => includeZero || row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN)
}

export function buildDiagnosisTimelineRows(parsedPdf, diagnosisId) {
  if (!diagnosisId) return []
  const diagnosis = (parsedPdf?.rows ?? []).find((row) => row.id === diagnosisId)
  if (!diagnosis) return []

  return (parsedPdf?.years ?? []).map((year) => ({
    label: year,
    value: Number(diagnosis.values?.[year] ?? 0),
  }))
}
