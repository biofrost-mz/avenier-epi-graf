export function formatNumber(value, maxFractionDigits = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: maxFractionDigits }).format(number)
}

export function parseNumber(value) {
  if (value === undefined || value === null) return 0
  const normalized = String(value).trim().replace(/\s+/g, '').replace(',', '.')
  const num = Number.parseFloat(normalized)
  return Number.isFinite(num) ? num : 0
}

export function getCzechPluralIndex(value) {
  const abs = Math.abs(Number(value))
  if (!Number.isFinite(abs) || !Number.isInteger(abs)) return 2
  if (abs === 1) return 0
  if (abs >= 2 && abs <= 4) return 1
  return 2
}

export function inflectUnit(value, forms) {
  const safe = {
    one: forms?.one || 'případ',
    few: forms?.few || 'případy',
    many: forms?.many || 'případů',
  }
  const index = getCzechPluralIndex(value)
  if (index === 0) return safe.one
  if (index === 1) return safe.few
  return safe.many
}

export function formatValueWithUnit(value, forms, maxFractionDigits = 1) {
  return `${formatNumber(value, maxFractionDigits)} ${inflectUnit(value, forms)}`
}

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
}
