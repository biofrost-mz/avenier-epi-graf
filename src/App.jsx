import React, { useEffect, useMemo, useRef, useState } from 'react'
import { arc as d3Arc, line as d3Line, pie as d3Pie } from 'd3'
import {
  buildDiagnosisTimelineRows,
  buildTopDiagnosisRows,
  mapObjectsToChartRows,
  parseManualText,
  parseTabularFile,
  parseUzisYearlyPdf,
} from './utils/importers'
import { decodeEmbedConfig, encodeEmbedConfig } from './utils/embed'
import { formatNumber, formatValueWithUnit, inflectUnit, parseNumber, slugify } from './utils/czech'

const COLOR_SCHEMES = [
  {
    id: 'avenier-greens',
    name: 'Avenier - odstíny zelené',
    colors: ['#2d5e08', '#3f7e11', '#5b9e1a', '#78be20', '#98d05b', '#bde18a', '#dcefc0'],
  },
  {
    id: 'avenier-brand',
    name: 'Avenier - brand mix',
    colors: ['#78be20', '#006778', '#0587aa', '#5b8f22', '#007ac9', '#ca005d', '#7d0063'],
  },
  {
    id: 'petrol-rose',
    name: 'Petrolej + akcent',
    colors: ['#006778', '#0587aa', '#007ac9', '#78be20', '#5b8f22', '#ca005d', '#7d0063'],
  },
  {
    id: 'gray-green',
    name: 'Šedá + zelená',
    colors: ['#425442', '#5d6f5d', '#778977', '#91a391', '#aebfae', '#cad8ca', '#e7eee7'],
  },
  {
    id: 'custom',
    name: 'Vlastní barvy (ruční)',
    colors: [],
  },
]

const EXPORT_PRESETS = [
  {
    id: 'full-report',
    label: 'Kompletni report',
    options: { header: true, subtitle: true, chart: true, stats: true, table: true, footer: true },
  },
  {
    id: 'brief',
    label: 'Rychlý náhled',
    options: { header: true, subtitle: false, chart: true, stats: false, table: false, footer: false },
  },
  {
    id: 'presentation',
    label: 'Prezentace',
    options: { header: true, subtitle: true, chart: true, stats: true, table: false, footer: true },
  },
]

const DEFAULT_TITLE = 'Epidemiologický přehled'
const DEFAULT_SUBTITLE = 'Avenier - interaktivní grafy'
const HISTORY_LIMIT = 90
const SAVED_SNAPSHOT_LIMIT = 28
const SNAPSHOT_STORAGE_KEY = 'avenier-epi-graf-snapshots-v1'
const SORT_MODES = ['manual', 'value-desc', 'value-asc', 'label-asc', 'label-desc']

const UNIT_FORMS = {
  pripad: { one: 'případ', few: 'případy', many: 'případů' },
  osoba: { one: 'osoba', few: 'osoby', many: 'osob' },
  obyvatel: { one: 'obyvatel', few: 'obyvatelé', many: 'obyvatel' },
  pacient: { one: 'pacient', few: 'pacienti', many: 'pacientů' },
  klient: { one: 'klient', few: 'klienti', many: 'klientů' },
  davka: { one: 'dávka', few: 'dávky', many: 'dávek' },
  test: { one: 'test', few: 'testy', many: 'testů' },
  vzorek: { one: 'vzorek', few: 'vzorky', many: 'vzorků' },
  navsteva: { one: 'návštěva', few: 'návštěvy', many: 'návštěv' },
  hospitalizace: { one: 'hospitalizace', few: 'hospitalizace', many: 'hospitalizací' },
  umrti: { one: 'úmrtí', few: 'úmrtí', many: 'úmrtí' },
  vakcinace: { one: 'vakcinace', few: 'vakcinace', many: 'vakcinací' },
  ockovani: { one: 'očkování', few: 'očkování', many: 'očkování' },
  den: { one: 'den', few: 'dny', many: 'dnů' },
  tyden: { one: 'týden', few: 'týdny', many: 'týdnů' },
  mesic: { one: 'měsíc', few: 'měsíce', many: 'měsíců' },
  rok: { one: 'rok', few: 'roky', many: 'let' },
  procento: { one: 'procento', few: 'procenta', many: 'procent' },
  bod: { one: 'bod', few: 'body', many: 'bodů' },
}

const UNIT_ALIASES = {
  pripady: 'pripad',
  pripadu: 'pripad',
  osoby: 'osoba',
  osob: 'osoba',
  obyvatele: 'obyvatel',
  pacienti: 'pacient',
  pacientu: 'pacient',
  klienti: 'klient',
  klientu: 'klient',
  davky: 'davka',
  davek: 'davka',
  testy: 'test',
  testu: 'test',
  vzorky: 'vzorek',
  vzorku: 'vzorek',
  navstevy: 'navsteva',
  navstev: 'navsteva',
  hospitalizaci: 'hospitalizace',
  umrti: 'umrti',
  vakcinaci: 'vakcinace',
  ockovani: 'ockovani',
  dny: 'den',
  tydny: 'tyden',
  tydnu: 'tyden',
  mesice: 'mesic',
  mesicu: 'mesic',
  roky: 'rok',
  let: 'rok',
  procenta: 'procento',
  procent: 'procento',
  body: 'bod',
  bodu: 'bod',
}

function normalizeWord(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function deriveUnitForms(unitBase) {
  const normalized = normalizeWord(unitBase)
  const key = UNIT_FORMS[normalized] ? normalized : UNIT_ALIASES[normalized]
  if (key && UNIT_FORMS[key]) return UNIT_FORMS[key]

  const base = String(unitBase ?? '').trim() || 'případ'
  if (/(ani|eni|i)$/i.test(normalized)) return { one: base, few: base, many: base }
  if (/ce$/i.test(normalized)) return { one: base, few: base, many: `${base.slice(0, -1)}i` }
  if (/ek$/i.test(normalized)) return { one: base, few: `${base.slice(0, -2)}ky`, many: `${base.slice(0, -2)}ku` }
  if (/a$/i.test(normalized)) return { one: base, few: `${base.slice(0, -1)}y`, many: `${base.slice(0, -1)}` }
  return { one: base, few: `${base}y`, many: `${base}u` }
}

function getSchemeColors(id) {
  const scheme = COLOR_SCHEMES.find((item) => item.id === id)
  return scheme?.colors?.length ? scheme.colors : COLOR_SCHEMES[0].colors
}

function getDefaultQuickFilters(chartType = 'bar') {
  return {
    sortBy: 'manual',
    topN: '',
    hideZero: chartType !== 'line',
  }
}

function sanitizeQuickFilters(filters, chartType = 'bar') {
  const defaults = getDefaultQuickFilters(chartType)
  const sortBy = SORT_MODES.includes(filters?.sortBy) ? filters.sortBy : defaults.sortBy
  const topNRaw = String(filters?.topN ?? '').trim()
  const topNValue = Number.parseInt(topNRaw, 10)
  const topN = Number.isFinite(topNValue) && topNValue > 0 ? String(topNValue) : ''
  const hideZero = typeof filters?.hideZero === 'boolean' ? filters.hideZero : defaults.hideZero
  return { sortBy, topN, hideZero }
}

function cloneRows(rows) {
  return (rows || []).map((row) => ({
    label: String(row?.label ?? ''),
    value: row?.value ?? 0,
    color: row?.color || '#78be20',
  }))
}

function formatSnapshotDate(isoValue) {
  if (!isoValue) return ''
  try {
    return new Date(isoValue).toLocaleString('cs-CZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(isoValue)
  }
}

function loadSavedSnapshots() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item === 'object' && item.id && item.state).slice(0, SAVED_SNAPSHOT_LIMIT)
  } catch {
    return []
  }
}

function buildSampleRows(colors) {
  return [
    { label: 'Středočeský kraj', value: 120, color: colors[0] },
    { label: 'Praha', value: 145, color: colors[1] },
    { label: 'Jihomoravský kraj', value: 95, color: colors[2] },
    { label: 'Moravskoslezský kraj', value: 83, color: colors[3] },
    { label: 'Plzeňský kraj', value: 64, color: colors[4] },
  ]
}

function applySchemeToRows(rows, schemeId) {
  const colors = getSchemeColors(schemeId)
  return rows.map((row, index) => ({
    ...row,
    color: colors[index % colors.length] || row.color || '#78be20',
  }))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function chunkLongToken(token, maxCharsPerLine) {
  if (token.length <= maxCharsPerLine) return [token]
  const chunks = []
  for (let index = 0; index < token.length; index += maxCharsPerLine) {
    chunks.push(token.slice(index, index + maxCharsPerLine))
  }
  return chunks
}

function wrapLabelLines(label, maxCharsPerLine = 14, maxLines = 3) {
  const safeLabel = String(label ?? '').trim()
  if (!safeLabel) return ['']

  const tokens = safeLabel.split(/\s+/).flatMap((token) => chunkLongToken(token, maxCharsPerLine))
  const lines = []
  let current = ''

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token
    if (candidate.length <= maxCharsPerLine) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = token
    if (lines.length >= maxLines - 1) break
  }

  if (current && lines.length < maxLines) lines.push(current)

  const consumedLength = lines.join(' ').length
  if (consumedLength < safeLabel.length && lines.length) {
    const lastLine = lines[lines.length - 1]
    lines[lines.length - 1] = lastLine.length >= maxCharsPerLine ? `${lastLine.slice(0, Math.max(1, maxCharsPerLine - 1))}…` : `${lastLine}…`
  }

  return lines.slice(0, maxLines)
}

function ellipsizeLabel(label, maxChars = 18) {
  const safeLabel = String(label ?? '').trim()
  if (safeLabel.length <= maxChars) return safeLabel
  return `${safeLabel.slice(0, Math.max(1, maxChars - 1))}…`
}

function normalizeBarWidthScale(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 54
  return clamp(parsed, 35, 95)
}

function getBarDensity(scale, renderMode = 'default') {
  const ratio = normalizeBarWidthScale(scale) / 100
  return renderMode === 'export' ? 0.36 + ratio * 0.64 : 0.22 + ratio * 0.68
}

function getHorizontalBarHeight(scale, renderMode = 'default') {
  const ratio = normalizeBarWidthScale(scale) / 100
  const minHeight = renderMode === 'export' ? 14 : 11
  const maxHeight = renderMode === 'export' ? 28 : 22
  return minHeight + (maxHeight - minHeight) * ratio
}

function isYearLabel(label) {
  return /^\d{4}$/.test(String(label ?? '').trim())
}

function computeStats(data) {
  if (!data.length) {
    return {
      total: 0,
      avg: 0,
      median: 0,
      min: null,
      max: null,
      stdDev: 0,
      top3share: 0,
      variation: 0,
    }
  }

  const values = data.map((item) => item.value)
  const total = values.reduce((sum, value) => sum + value, 0)
  const avg = total / values.length
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const min = data.find((item) => item.value === minValue) || null
  const max = data.find((item) => item.value === maxValue) || null
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)
  const top3sum = [...values].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0)
  const top3share = total > 0 ? (top3sum / total) * 100 : 0
  const variation = maxValue - minValue

  return { total, avg, median, min, max, stdDev, top3share, variation }
}

function getUrlConfig() {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  const variant = params.get('variant') || 'expanded'
  const config = decodeEmbedConfig(params.get('cfg'))
  return {
    embedMode: mode === 'embed',
    embedVariant: variant,
    config,
  }
}

function HoverTooltip({ tooltip, unitForms }) {
  if (!tooltip) return null
  return (
    <div className="chartTooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <div className="chartTooltipTitle">{tooltip.label}</div>
      <div className="chartTooltipValue">{formatValueWithUnit(tooltip.value, unitForms)}</div>
      {tooltip.percent !== undefined ? <div className="chartTooltipMeta">Podíl: {formatNumber(tooltip.percent, 1)} %</div> : null}
      {tooltip.rank !== undefined ? <div className="chartTooltipMeta">Pořadí: #{tooltip.rank}</div> : null}
    </div>
  )
}

function BarChart({ data, unitForms, referenceLine, xAxisLabel, yAxisLabel, renderMode = 'default', barWidthScale = 54 }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data.length) return <div className="chartEmpty">Přidejte alespoň jednu položku s hodnotou větší než 0.</div>

  const isExport = renderMode === 'export'
  const width = 920
  const height = isExport ? 520 : 470
  const sideMargin = isExport ? { top: 24, right: 22, left: 56 } : { top: 34, right: 34, left: 74 }
  const preliminaryInnerWidth = width - sideMargin.left - sideMargin.right
  const preliminaryStepX = preliminaryInnerWidth / data.length
  const useWrappedLabels = data.length <= (isExport ? 12 : 10) && preliminaryStepX >= (isExport ? 54 : 48)
  const maxCharsPerLine = clamp(Math.floor(preliminaryStepX / 7), 8, isExport ? 20 : 16)
  const wrappedLabels = data.map((item) => wrapLabelLines(item.label, maxCharsPerLine, 3))
  const maxLabelLines = Math.max(...wrappedLabels.map((lines) => lines.length), 1)
  const margin = {
    ...sideMargin,
    bottom: useWrappedLabels ? 56 + maxLabelLines * 14 : isExport ? 104 : 118,
  }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const refValue = referenceLine?.enabled ? Math.max(0, parseNumber(referenceLine.value)) : 0
  const maxValue = Math.max(...data.map((item) => item.value), refValue, 1)
  const ticks = 5
  const stepX = innerWidth / data.length
  const barWidth = Math.min(isExport ? 128 : 96, stepX * getBarDensity(barWidthScale, renderMode))
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const sortedByValue = [...data].sort((a, b) => b.value - a.value)

  function handleHover(event, item) {
    const svgRect = event.currentTarget.ownerSVGElement.getBoundingClientRect()
    setTooltip({
      x: clamp(event.clientX - svgRect.left + 12, 8, svgRect.width - 220),
      y: clamp(event.clientY - svgRect.top + 12, 8, svgRect.height - 96),
      label: item.label,
      value: item.value,
      percent: total > 0 ? (item.value / total) * 100 : 0,
      rank: sortedByValue.findIndex((entry) => entry.label === item.label) + 1,
    })
  }

  return (
    <div className="chartCanvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Klasický sloupcový graf">
        <rect x="0" y="0" width={width} height={height} fill="#fff" />
        {Array.from({ length: ticks + 1 }, (_, idx) => {
          const value = (maxValue / ticks) * idx
          const y = margin.top + innerHeight - (value / maxValue) * innerHeight
          return (
            <g key={value}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="#e0e8d8" strokeWidth="1" />
              <text x={margin.left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="#6b7c5a">
                {formatNumber(value)}
              </text>
            </g>
          )
        })}
        {referenceLine?.enabled && refValue > 0 ? (
          <g>
            <line
              x1={margin.left}
              y1={margin.top + innerHeight - (refValue / maxValue) * innerHeight}
              x2={width - margin.right}
              y2={margin.top + innerHeight - (refValue / maxValue) * innerHeight}
              stroke="#006778"
              strokeWidth="1.8"
              strokeDasharray="5 4"
            />
            <text
              x={width - margin.right}
              y={margin.top + innerHeight - (refValue / maxValue) * innerHeight - 8}
              textAnchor="end"
              fontSize="12"
              fill="#006778"
              fontWeight="700"
            >
              {referenceLine.label || 'Cíl'}: {formatNumber(refValue)}
            </text>
          </g>
        ) : null}
        <line x1={margin.left} y1={margin.top + innerHeight} x2={width - margin.right} y2={margin.top + innerHeight} stroke="#b7c9a2" strokeWidth="1.2" />

        {data.map((item, idx) => {
          const x = margin.left + idx * stepX + (stepX - barWidth) / 2
          const barHeight = (item.value / maxValue) * innerHeight
          const y = margin.top + innerHeight - barHeight
          return (
            <g key={`${item.label}-${idx}`}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={item.color} rx="7" onMouseMove={(event) => handleHover(event, item)} onMouseLeave={() => setTooltip(null)} />
              <text x={x + barWidth / 2} y={y - 10} textAnchor="middle" fontSize="12" fontWeight="600" fill="#3c3c3c">
                {formatNumber(item.value)}
              </text>
              {useWrappedLabels ? (
                <text x={x + barWidth / 2} y={margin.top + innerHeight + 18} textAnchor="middle" fontSize="12" fill="#4e6554">
                  {wrappedLabels[idx].map((line, lineIndex) => (
                    <tspan key={`${item.label}-${lineIndex}`} x={x + barWidth / 2} dy={lineIndex === 0 ? 0 : 13}>
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : (
                <text
                  x={x + barWidth / 2}
                  y={margin.top + innerHeight + 18}
                  textAnchor="end"
                  transform={`rotate(-35 ${x + barWidth / 2} ${margin.top + innerHeight + 18})`}
                  fontSize="12"
                  fill="#4e6554"
                >
                  {ellipsizeLabel(item.label, clamp(Math.floor(stepX / 5), 10, 24))}
                </text>
              )}
            </g>
          )
        })}

        {yAxisLabel ? (
          <text x="18" y={margin.top + innerHeight / 2} transform={`rotate(-90 18 ${margin.top + innerHeight / 2})`} textAnchor="middle" fontSize="12" fill="#5f7156">
            {yAxisLabel}
          </text>
        ) : null}
        {xAxisLabel ? (
          <text x={margin.left + innerWidth / 2} y={height - 8} textAnchor="middle" fontSize="12" fill="#5f7156">
            {xAxisLabel}
          </text>
        ) : null}
      </svg>
      <HoverTooltip tooltip={tooltip} unitForms={unitForms} />
    </div>
  )
}

function HorizontalBarChart({ data, unitForms, referenceLine, xAxisLabel, yAxisLabel, renderMode = 'default', barWidthScale = 54 }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data.length) return <div className="chartEmpty">Přidejte alespoň jednu položku s hodnotou větší než 0.</div>

  const isExport = renderMode === 'export'
  const width = 920
  const baseLabelChars = isExport ? 26 : 22
  const wrappedLabels = data.map((item) => wrapLabelLines(item.label, baseLabelChars, 3))
  const maxLabelLines = Math.max(...wrappedLabels.map((lines) => lines.length), 1)
  const rowHeight = (isExport ? 34 : 28) + (maxLabelLines - 1) * 12
  const longestLineLength = Math.max(...wrappedLabels.flatMap((lines) => lines.map((line) => line.length)), 0)
  const dynamicLeft = clamp(92 + longestLineLength * (isExport ? 6.8 : 6.2), 220, isExport ? 430 : 360)
  const height = Math.max(isExport ? 430 : 360, (isExport ? 124 : 102) + data.length * rowHeight)
  const margin = isExport ? { top: 24, right: 26, bottom: 52, left: dynamicLeft } : { top: 24, right: 32, bottom: 44, left: dynamicLeft }
  const innerWidth = width - margin.left - margin.right
  const refValue = referenceLine?.enabled ? Math.max(0, parseNumber(referenceLine.value)) : 0
  const maxValue = Math.max(...data.map((item) => item.value), refValue, 1)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const ticks = 5
  const barHeight = getHorizontalBarHeight(barWidthScale, renderMode)

  function handleHover(event, item, rank) {
    const svgRect = event.currentTarget.ownerSVGElement.getBoundingClientRect()
    setTooltip({
      x: clamp(event.clientX - svgRect.left + 12, 8, svgRect.width - 220),
      y: clamp(event.clientY - svgRect.top + 12, 8, svgRect.height - 96),
      label: item.label,
      value: item.value,
      percent: total > 0 ? (item.value / total) * 100 : 0,
      rank,
    })
  }

  return (
    <div className="chartCanvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Vodorovný sloupcový graf">
        <rect x="0" y="0" width={width} height={height} fill="#fff" />
        {Array.from({ length: ticks + 1 }, (_, idx) => {
          const value = (maxValue / ticks) * idx
          const x = margin.left + (value / maxValue) * innerWidth
          return (
            <g key={`tick-${value}`}>
              <line x1={x} y1={margin.top - 4} x2={x} y2={height - margin.bottom} stroke="#e0e8d8" strokeWidth="1" />
              <text x={x} y={height - margin.bottom + 16} textAnchor="middle" fontSize="12" fill="#6b7c5a">
                {formatNumber(value)}
              </text>
            </g>
          )
        })}
        <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} stroke="#b7c9a2" strokeWidth="1.2" />
        {data.map((item, index) => {
          const y = margin.top + index * rowHeight
          const barWidth = (item.value / maxValue) * innerWidth
          const labelLines = wrappedLabels[index]
          const labelStartY = y + rowHeight / 2 - ((labelLines.length - 1) * 12) / 2 + 4
          return (
            <g key={`${item.label}-${index}`}>
              <text x={margin.left - 10} y={labelStartY} textAnchor="end" fontSize="12" fill="#3f4f46">
                {labelLines.map((line, lineIndex) => (
                  <tspan key={`${item.label}-line-${lineIndex}`} x={margin.left - 10} dy={lineIndex === 0 ? 0 : 12}>
                    {line}
                  </tspan>
                ))}
              </text>
              <rect
                x={margin.left}
                y={y + (rowHeight - barHeight) / 2}
                width={barWidth}
                height={barHeight}
                rx="7"
                fill={item.color}
                onMouseMove={(event) => handleHover(event, item, index + 1)}
                onMouseLeave={() => setTooltip(null)}
              />
              <text x={margin.left + barWidth + 8} y={y + rowHeight / 2 + 4} fontSize={isExport ? '13' : '12'} fill="#2f3f35" fontWeight="600">
                {formatNumber(item.value)}
              </text>
            </g>
          )
        })}
        {referenceLine?.enabled && refValue > 0 ? (
          <g>
            <line
              x1={margin.left + (refValue / maxValue) * innerWidth}
              y1={margin.top - 6}
              x2={margin.left + (refValue / maxValue) * innerWidth}
              y2={height - margin.bottom}
              stroke="#006778"
              strokeWidth="1.8"
              strokeDasharray="5 4"
            />
            <text x={margin.left + (refValue / maxValue) * innerWidth + 6} y={margin.top - 9} fontSize="12" fill="#006778" fontWeight="700">
              {referenceLine.label || 'Cíl'}: {formatNumber(refValue)}
            </text>
          </g>
        ) : null}
        {yAxisLabel ? (
          <text x="18" y={height / 2} transform={`rotate(-90 18 ${height / 2})`} textAnchor="middle" fontSize="12" fill="#5f7156">
            {yAxisLabel}
          </text>
        ) : null}
        {xAxisLabel ? (
          <text x={margin.left + innerWidth / 2} y={height - 4} textAnchor="middle" fontSize="12" fill="#5f7156">
            {xAxisLabel}
          </text>
        ) : null}
      </svg>
      <HoverTooltip tooltip={tooltip} unitForms={unitForms} />
    </div>
  )
}

function LineChart({ data, unitForms, referenceLine, xAxisLabel, yAxisLabel, renderMode = 'default' }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data.length) return <div className="chartEmpty">Přidejte alespoň jednu položku s hodnotou větší než 0.</div>

  const isExport = renderMode === 'export'
  const width = 920
  const height = isExport ? 520 : 470
  const sideMargin = isExport ? { top: 26, right: 24, left: 56 } : { top: 34, right: 34, left: 74 }
  const preliminaryInnerWidth = width - sideMargin.left - sideMargin.right
  const preliminaryDenominator = data.length > 1 ? data.length - 1 : 1
  const preliminaryStepX = preliminaryInnerWidth / preliminaryDenominator
  const maxCharsPerLine = clamp(Math.floor(preliminaryStepX / 7), 8, isExport ? 18 : 14)
  const wrappedLabels = data.map((item) => wrapLabelLines(item.label, maxCharsPerLine, 2))
  const maxLabelLines = Math.max(...wrappedLabels.map((lines) => lines.length), 1)
  const margin = {
    ...sideMargin,
    bottom: 42 + maxLabelLines * 14,
  }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const refValue = referenceLine?.enabled ? Math.max(0, parseNumber(referenceLine.value)) : 0
  const maxValue = Math.max(...data.map((item) => item.value), refValue, 1)
  const ticks = 5
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const points = data.map((item, index) => {
    const x = margin.left + (index / Math.max(1, data.length - 1)) * innerWidth
    const y = margin.top + innerHeight - (item.value / maxValue) * innerHeight
    return { ...item, x, y }
  })
  const linePath = d3Line().x((point) => point.x).y((point) => point.y)(points)

  function handleHover(event, item) {
    const svgRect = event.currentTarget.ownerSVGElement.getBoundingClientRect()
    setTooltip({
      x: clamp(event.clientX - svgRect.left + 12, 8, svgRect.width - 220),
      y: clamp(event.clientY - svgRect.top + 12, 8, svgRect.height - 96),
      label: item.label,
      value: item.value,
      percent: total > 0 ? (item.value / total) * 100 : 0,
    })
  }

  return (
    <div className="chartCanvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Liniový graf">
        <rect x="0" y="0" width={width} height={height} fill="#fff" />
        {Array.from({ length: ticks + 1 }, (_, idx) => {
          const value = (maxValue / ticks) * idx
          const y = margin.top + innerHeight - (value / maxValue) * innerHeight
          return (
            <g key={value}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="#e0e8d8" strokeWidth="1" />
              <text x={margin.left - 12} y={y + 4} textAnchor="end" fontSize="12" fill="#6b7c5a">
                {formatNumber(value)}
              </text>
            </g>
          )
        })}
        {referenceLine?.enabled && refValue > 0 ? (
          <g>
            <line
              x1={margin.left}
              y1={margin.top + innerHeight - (refValue / maxValue) * innerHeight}
              x2={width - margin.right}
              y2={margin.top + innerHeight - (refValue / maxValue) * innerHeight}
              stroke="#006778"
              strokeWidth="1.8"
              strokeDasharray="5 4"
            />
            <text
              x={width - margin.right}
              y={margin.top + innerHeight - (refValue / maxValue) * innerHeight - 8}
              textAnchor="end"
              fontSize="12"
              fill="#006778"
              fontWeight="700"
            >
              {referenceLine.label || 'Cíl'}: {formatNumber(refValue)}
            </text>
          </g>
        ) : null}
        <path d={linePath || ''} fill="none" stroke="#006778" strokeWidth={isExport ? '4' : '3'} />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r={isExport ? '7.5' : '6'} fill="#78be20" stroke="#ffffff" strokeWidth="2" onMouseMove={(event) => handleHover(event, point)} onMouseLeave={() => setTooltip(null)} />
            <text x={point.x} y={point.y - 12} textAnchor="middle" fontSize="11" fontWeight="700" fill="#2f4a3d" paintOrder="stroke" stroke="#fff" strokeWidth="3">
              {ellipsizeLabel(point.label, isExport ? 18 : 14)}
            </text>
            <text x={point.x} y={margin.top + innerHeight + 18} textAnchor="middle" fontSize={isExport ? '11' : '12'} fill="#4e6554">
              {wrappedLabels[index].map((line, lineIndex) => (
                <tspan key={`${point.label}-axis-${lineIndex}`} x={point.x} dy={lineIndex === 0 ? 0 : 13}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        ))}
        {yAxisLabel ? (
          <text x="18" y={margin.top + innerHeight / 2} transform={`rotate(-90 18 ${margin.top + innerHeight / 2})`} textAnchor="middle" fontSize="12" fill="#5f7156">
            {yAxisLabel}
          </text>
        ) : null}
        {xAxisLabel ? (
          <text x={margin.left + innerWidth / 2} y={height - 8} textAnchor="middle" fontSize="12" fill="#5f7156">
            {xAxisLabel}
          </text>
        ) : null}
      </svg>
      <HoverTooltip tooltip={tooltip} unitForms={unitForms} />
    </div>
  )
}

function PieChart({ data, unitForms, renderMode = 'default' }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data.length) return <div className="chartEmpty">Přidejte alespoň jednu položku s hodnotou větší než 0.</div>

  const isExport = renderMode === 'export'
  const width = 920
  const height = isExport ? 520 : 470
  const centerX = 328
  const centerY = isExport ? 258 : 236
  const radius = isExport ? 170 : 156
  const labelLineLength = isExport ? 34 : 28
  const pieGenerator = d3Pie().value((item) => item.value).sort(null)
  const arcGenerator = d3Arc().innerRadius(0).outerRadius(radius)
  const pieData = pieGenerator(data)
  const total = data.reduce((sum, item) => sum + item.value, 0)

  function handleHover(event, item) {
    const svgRect = event.currentTarget.ownerSVGElement.getBoundingClientRect()
    setTooltip({
      x: clamp(event.clientX - svgRect.left + 12, 8, svgRect.width - 220),
      y: clamp(event.clientY - svgRect.top + 12, 8, svgRect.height - 96),
      label: item.label,
      value: item.value,
      percent: total > 0 ? (item.value / total) * 100 : 0,
    })
  }

  return (
    <div className="chartCanvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Koláčový graf">
        <rect x="0" y="0" width={width} height={height} fill="#fff" />
        <g transform={`translate(${centerX}, ${centerY})`}>
          {pieData.map((slice, idx) => {
            const path = arcGenerator(slice)
            const midAngle = (slice.startAngle + slice.endAngle) / 2
            const labelLines = wrapLabelLines(slice.data.label, isExport ? 22 : 18, 2)
            const isRight = Math.cos(midAngle) >= 0
            const lineStart = [Math.cos(midAngle) * radius, Math.sin(midAngle) * radius]
            const lineEnd = [Math.cos(midAngle) * (radius + labelLineLength), Math.sin(midAngle) * (radius + labelLineLength)]
            const labelX = lineEnd[0] + (isRight ? 12 : -12)
            const anchor = isRight ? 'start' : 'end'
            const labelTextStartY = lineEnd[1] - ((labelLines.length - 1) * 11) / 2 - 6
            const percent = total > 0 ? (slice.data.value / total) * 100 : 0
            return (
              <g key={`${slice.data.label}-${idx}`}>
                <path d={path || ''} fill={slice.data.color} stroke="#fff" strokeWidth="2" onMouseMove={(event) => handleHover(event, slice.data)} onMouseLeave={() => setTooltip(null)} />
                <line x1={lineStart[0]} y1={lineStart[1]} x2={lineEnd[0]} y2={lineEnd[1]} stroke="#8ea78a" strokeWidth="1.2" />
                <text x={labelX} y={labelTextStartY} textAnchor={anchor} fontSize="11" fontWeight="700" fill="#2f4a3d" paintOrder="stroke" stroke="#fff" strokeWidth="3">
                  {labelLines.map((line, lineIndex) => (
                    <tspan key={`${slice.data.label}-line-${lineIndex}`} x={labelX} dy={lineIndex === 0 ? 0 : 12}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text x={labelX} y={labelTextStartY + labelLines.length * 12 + 2} textAnchor={anchor} fontSize="10" fill="#5f7156" paintOrder="stroke" stroke="#fff" strokeWidth="3">
                  {formatNumber(percent, 1)} %
                </text>
              </g>
            )
          })}
        </g>
        <g transform="translate(596, 112)">
          {data.map((item, idx) => {
            const y = idx * 30
            const percent = total > 0 ? (item.value / total) * 100 : 0
            return (
              <g key={`${item.label}-legend-${idx}`} transform={`translate(0, ${y})`}>
                <rect width="16" height="16" rx="3" fill={item.color} />
                <text x="24" y="13" fontSize="12" fill="#1a1a1a">
                  {item.label} ({formatNumber(item.value)}, {formatNumber(percent, 1)} %)
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <HoverTooltip tooltip={tooltip} unitForms={unitForms} />
    </div>
  )
}

function ChartRenderer({ chartType, data, unitForms, referenceLine, xAxisLabel, yAxisLabel, renderMode = 'default', barWidthScale = 54 }) {
  if (chartType === 'bar') return <BarChart data={data} unitForms={unitForms} referenceLine={referenceLine} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} renderMode={renderMode} barWidthScale={barWidthScale} />
  if (chartType === 'pie') return <PieChart data={data} unitForms={unitForms} renderMode={renderMode} />
  if (chartType === 'line') return <LineChart data={data} unitForms={unitForms} referenceLine={referenceLine} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} renderMode={renderMode} />
  if (chartType === 'hbar') return <HorizontalBarChart data={data} unitForms={unitForms} referenceLine={referenceLine} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} renderMode={renderMode} barWidthScale={barWidthScale} />
  return <BarChart data={data} unitForms={unitForms} referenceLine={referenceLine} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} renderMode={renderMode} barWidthScale={barWidthScale} />
}

function ChartFrame({ title, subtitle, chartType, data, unitForms, referenceLine, annotationText, xAxisLabel, yAxisLabel, renderMode = 'default', barWidthScale = 54 }) {
  return (
    <section className="chartFrame">
      <div className="chartHead">
        <h2>{title || 'Náhled grafu'}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <ChartRenderer chartType={chartType} data={data} unitForms={unitForms} referenceLine={referenceLine} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} renderMode={renderMode} barWidthScale={barWidthScale} />
      {annotationText ? <p className="chartNote">{annotationText}</p> : null}
    </section>
  )
}

function StatsPanel({ data, unitForms }) {
  const stats = computeStats(data)
  const cards = [
    { label: 'Průměr', value: formatValueWithUnit(stats.avg, unitForms), desc: 'Aritmetický průměr všech kategorií' },
    { label: 'Medián', value: formatValueWithUnit(stats.median, unitForms), desc: 'Středová hodnota po seřazení' },
    { label: 'Směrodatná odchylka', value: formatNumber(stats.stdDev, 2), desc: 'Míra variability dat' },
    { label: 'Koncentrace TOP 3', value: `${formatNumber(stats.top3share, 1)} %`, desc: 'Podíl tří největších kategorií' },
    { label: 'Minimum', value: stats.min ? `${stats.min.label}: ${formatValueWithUnit(stats.min.value, unitForms)}` : '-', desc: 'Nejnižší hodnota' },
    { label: 'Maximum', value: stats.max ? `${stats.max.label}: ${formatValueWithUnit(stats.max.value, unitForms)}` : '-', desc: 'Nejvyšší hodnota' },
    { label: 'Rozpětí', value: formatValueWithUnit(stats.variation, unitForms), desc: 'Rozdíl mezi max a min' },
  ]

  return (
    <section className="statsSection">
      <div className="panelHeader compact"><h3>Dodatečné statistiky</h3></div>
      <div className="statsGrid">
        {cards.map((card) => (
          <article className="statCard" key={card.label}>
            <p className="statLabel">{card.label}</p>
            <p className="statValue">{card.value}</p>
            <p className="statDesc">{card.desc}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function AvenierLogo({ size = 30 }) {
  return <img src="/logo.png" alt="Avenier" style={{ height: `${size}px`, width: 'auto', display: 'block' }} />
}

function PdfImportBox({ state, onUpload, onChange, onApply }) {
  return (
    <section className="importCard">
      <div className="panelHeader compact"><h3>Import PDF (ÚZIS)</h3></div>
      <label className="fileBtn">
        Vybrat PDF tabulku
        <input type="file" accept="application/pdf" onChange={(event) => onUpload(event.target.files?.[0])} />
      </label>
      {state.fileName ? <p className="helperText">Soubor: {state.fileName}</p> : null}
      {state.rows.length ? (
        <>
          <label>
            Režim importu
            <select value={state.mode} onChange={(event) => onChange({ mode: event.target.value })}>
              <option value="top-year">Top diagnóz v roce</option>
              <option value="timeline">Vývoj jedné diagnózy</option>
            </select>
          </label>
          {state.mode === 'top-year' ? (
            <div className="inlineRow twoCols">
              <label>
                Rok
                <select value={state.year} onChange={(event) => onChange({ year: event.target.value })}>
                  {state.years.map((year) => <option value={year} key={year}>{year}</option>)}
                </select>
              </label>
              <label>
                Počet řádků
                <input type="number" min="1" max="200" value={state.topN} onChange={(event) => onChange({ topN: event.target.value })} />
              </label>
            </div>
          ) : (
            <label>
              Diagnóza
              <select value={state.diagnosisId} onChange={(event) => onChange({ diagnosisId: event.target.value })}>
                {state.rows.map((row) => <option key={row.id} value={row.id}>{row.code} {row.diagnosis}</option>)}
              </select>
            </label>
          )}
          <label className="checkboxRow">
            <input type="checkbox" checked={state.includeZero} onChange={(event) => onChange({ includeZero: event.target.checked })} />
            <span>Ponechat i nulové hodnoty</span>
          </label>
          <button className="editBtn" onClick={onApply}>Aplikovat import PDF</button>
        </>
      ) : null}
      {state.message ? <p className="helperText">{state.message}</p> : null}
      {state.busy ? <p className="helperText">Načítám PDF, prosím počkejte...</p> : null}
    </section>
  )
}

function ExportModal({ open, onClose, options, onToggle, onApplyPreset, activePreset, previewRef, onExportPng, onExportPdf, children, context }) {
  if (!open) return null
  return (
    <div className="modalOverlay" onClick={onClose}>
      <section className="modalPanel exportModal" onClick={(event) => event.stopPropagation()}>
        <aside className="exportSidebar">
          <h3>Export reportu</h3>
          <p>Zvolte obsah výstupu a formát.</p>
          <div className="presetGroup">
            <h4>Šablona exportu</h4>
            <div className="presetButtons">
              {EXPORT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`presetBtn ${activePreset === preset.id ? 'active' : ''}`}
                  onClick={() => onApplyPreset(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="optionGroup">
            {[
              ['header', 'Hlavička'],
              ['subtitle', 'Podnadpis'],
              ['chart', 'Graf'],
              ['stats', 'Statistiky'],
              ['table', 'Tabulka dat'],
              ['footer', 'Zdroj + poznámka'],
            ].map(([key, label]) => (
              <label key={key} className="checkboxRow">
                <input type="checkbox" checked={options[key]} onChange={() => onToggle(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="exportMeta">
            <div><strong>Typ:</strong> {context.chartName}</div>
            <div><strong>Položek:</strong> {context.count}</div>
            <div><strong>Zdroj:</strong> {context.sourceLabel || 'vlastní dataset'}</div>
          </div>
          <button className="editBtn" onClick={onExportPng}>Export PNG</button>
          <button className="exportBtn" onClick={onExportPdf}>Export PDF</button>
          <button className="btnSecondary" onClick={onClose}>Zavřít</button>
        </aside>
        <div className="exportPreviewWrap">
          <div className="exportPreview" ref={previewRef}>{children}</div>
        </div>
      </section>
    </div>
  )
}

function EmbedModal({ open, onClose, settings, onSettingsChange, embedUrl, iframeCode, onCopyUrl, onCopyIframe, copied }) {
  if (!open) return null
  return (
    <div className="modalOverlay" onClick={onClose}>
      <section className="modalPanel embedModal" onClick={(event) => event.stopPropagation()}>
        <header className="modalHeader withBg">
          <div>
            <h3>Sdílet graf (iframe)</h3>
            <p>Generovaný odkaz obsahuje snapshot dat, takže starší vložené grafy zůstanou funkční.</p>
          </div>
          <button className="iconBtn" onClick={onClose}>x</button>
        </header>
        <div className="embedControls">
          <label>
            Varianta
            <select value={settings.variant} onChange={(event) => onSettingsChange({ variant: event.target.value })}>
              <option value="expanded">Rozšířená (graf + statistiky)</option>
              <option value="compact">Kompaktní (jen graf)</option>
            </select>
          </label>
          <label>
            Výchozí zobrazení
            <select value={settings.chartType} onChange={(event) => onSettingsChange({ chartType: event.target.value })}>
              <option value="bar">Klasický sloupcový</option>
              <option value="pie">Koláčový</option>
              <option value="line">Liniový</option>
              <option value="hbar">Vodorovný sloupcový</option>
            </select>
          </label>
          <label>
            Výška iframe (px)
            <input type="number" min="320" max="2200" value={settings.height} onChange={(event) => onSettingsChange({ height: Number(event.target.value || 780) })} />
          </label>
        </div>
        <div className="embedBlock">
          <h4>URL pro sdílení</h4>
          <textarea readOnly rows={3} value={embedUrl} />
          <button className="exportBtn" onClick={onCopyUrl}>{copied === 'url' ? 'Zkopírováno' : 'Kopírovat URL'}</button>
        </div>
        <div className="embedBlock">
          <h4>Iframe kód</h4>
          <textarea readOnly rows={5} value={iframeCode} />
          <button className="editBtn" onClick={onCopyIframe}>{copied === 'iframe' ? 'Zkopírováno' : 'Kopírovat iframe kód'}</button>
        </div>
      </section>
    </div>
  )
}

function EditorDrawer({ open, onClose, children }) {
  return (
    <div className={`drawerOverlay ${open ? 'open' : ''}`} onClick={onClose}>
      <aside className={`drawerPanel ${open ? 'open' : ''}`} onClick={(event) => event.stopPropagation()}>
        <header className="drawerHeader">
          <h3>Upravit data</h3>
          <button className="iconBtn" onClick={onClose}>x</button>
        </header>
        <div className="drawerBody">{children}</div>
      </aside>
    </div>
  )
}

function AccordionSection({ title, open, onToggle, children, badge }) {
  return (
    <section className={`sidebarSection ${open ? 'open' : ''}`}>
      <button className="sidebarSectionHead" onClick={onToggle} type="button">
        <span>{title}</span>
        <div className="sidebarSectionHeadRight">
          {badge ? <small>{badge}</small> : null}
          <strong>{open ? '−' : '+'}</strong>
        </div>
      </button>
      {open ? <div className="sidebarSectionBody">{children}</div> : null}
    </section>
  )
}

function ToolbarIcon({ name }) {
  if (name === 'save') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4h9l3 3v13H6z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
        <path d="M9 4v6h6V4M9 17h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'export') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10m0 0-4-4m4 4 4-4M5 18h14" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'embed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9 7-5 5 5 5m6-10 5 5-5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'panel') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M10 5v14" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  if (name === 'new') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'history') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return null
}

function NewChartModal({ open, onClose, onCreate }) {
  const [draftType, setDraftType] = useState('bar')
  const [draftTitle, setDraftTitle] = useState('Nový graf')
  const [draftSubtitle, setDraftSubtitle] = useState('Doplňte data a exportujte výstup')
  if (!open) return null

  return (
    <div className="modalOverlay" onClick={onClose}>
      <section className="modalPanel" onClick={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <h3>Vytvořit nový graf</h3>
          <button className="iconBtn" onClick={onClose}>x</button>
        </header>
        <div className="modalBody">
          <label>
            Typ grafu
            <select value={draftType} onChange={(event) => setDraftType(event.target.value)}>
              <option value="bar">Klasický sloupcový</option>
              <option value="pie">Koláčový</option>
              <option value="line">Liniový</option>
              <option value="hbar">Vodorovný sloupcový</option>
            </select>
          </label>
          <label>
            Název
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
          </label>
          <label>
            Podnadpis
            <input value={draftSubtitle} onChange={(event) => setDraftSubtitle(event.target.value)} />
          </label>
        </div>
        <footer className="modalFooter">
          <button className="btnSecondary" onClick={onClose}>Zrušit</button>
          <button className="editBtn" onClick={() => onCreate({ chartType: draftType, title: draftTitle, subtitle: draftSubtitle })}>Vytvořit</button>
        </footer>
      </section>
    </div>
  )
}

function HistoryModal({
  open,
  onClose,
  historyPast,
  historyFuture,
  onUndo,
  onRedo,
  snapshotName,
  onSnapshotNameChange,
  onSaveSnapshot,
  onLoadLast,
  savedSnapshots,
  onRestoreSnapshot,
  onDeleteSnapshot,
}) {
  if (!open) return null
  return (
    <div className="modalOverlay" onClick={onClose}>
      <section className="modalPanel historyModalPanel" onClick={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <h3>Historie a uložené</h3>
          <button className="iconBtn" onClick={onClose}>x</button>
        </header>
        <div className="historyModalBody">
          <div className="historyPanel">
            <div className="historyButtons">
              <button className="btnSecondary" onClick={onUndo} disabled={!historyPast.length}>Zpět</button>
              <button className="btnSecondary" onClick={onRedo} disabled={!historyFuture.length}>Vpřed</button>
            </div>
            <p className="helperText">Historie funguje i klávesami Cmd/Ctrl + Z a Cmd/Ctrl + Shift + Z.</p>
          </div>

          <div className="snapshotBox">
            <label>
              Název uloženého grafu
              <input value={snapshotName} onChange={(event) => onSnapshotNameChange(event.target.value)} placeholder="Např. Leden 2026 - final" />
            </label>
            <div className="quickActions">
              <button className="btnSecondary" onClick={onSaveSnapshot}>Uložit graf</button>
              <button className="btnSecondary" onClick={onLoadLast} disabled={!savedSnapshots.length}>Načíst poslední</button>
            </div>
            <div className="snapshotList">
              {savedSnapshots.length ? (
                savedSnapshots.map((item) => (
                  <article className="snapshotItem" key={item.id}>
                    <div className="snapshotMeta">
                      <strong>{item.name}</strong>
                      <span>{formatSnapshotDate(item.createdAt)}</span>
                    </div>
                    <div className="snapshotActions">
                      <button className="btnSecondary" onClick={() => onRestoreSnapshot(item)}>Načíst</button>
                      {item.id !== 'auto' ? <button className="btnSecondary" onClick={() => onDeleteSnapshot(item.id)}>Smazat</button> : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="helperText">Zatím nejsou uložené snapshoty.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const { embedMode, embedVariant, config } = useMemo(() => getUrlConfig(), [])
  const initialPalette = config?.paletteId || 'avenier-greens'
  const initialRows = (config?.rows || buildSampleRows(getSchemeColors(initialPalette))).map((row, index) => ({
    label: String(row.label ?? '').trim(),
    value: Number(row.value ?? 0),
    color: row.color || getSchemeColors(initialPalette)[index % getSchemeColors(initialPalette).length],
  }))

  const [chartType, setChartType] = useState(config?.chartType || 'bar')
  const [title, setTitle] = useState(config?.title || DEFAULT_TITLE)
  const [subtitle, setSubtitle] = useState(config?.subtitle || DEFAULT_SUBTITLE)
  const [sourceLabel, setSourceLabel] = useState(config?.sourceLabel || 'vlastní dataset')
  const [unitBase, setUnitBase] = useState(config?.unitBase || 'případ')
  const [barWidthScale, setBarWidthScale] = useState(normalizeBarWidthScale(config?.barWidthScale))
  const [paletteId, setPaletteId] = useState(initialPalette)
  const [rows, setRows] = useState(initialRows)
  const [xDirection, setXDirection] = useState(config?.xDirection || 'normal')
  const [xAxisLabel, setXAxisLabel] = useState(config?.xAxisLabel || '')
  const [yAxisLabel, setYAxisLabel] = useState(config?.yAxisLabel || '')
  const [annotationText, setAnnotationText] = useState(config?.annotationText || '')
  const [referenceLine, setReferenceLine] = useState({
    enabled: Boolean(config?.referenceLine?.enabled),
    value: config?.referenceLine?.value ?? '',
    label: config?.referenceLine?.label || 'Cíl',
  })
  const [quickFilters, setQuickFilters] = useState(sanitizeQuickFilters(config?.quickFilters, config?.chartType || 'bar'))
  const [editorDataView, setEditorDataView] = useState('form')
  const [workspaceView, setWorkspaceView] = useState('preview')
  const [sidebarOpen, setSidebarOpen] = useState(typeof window === 'undefined' ? true : window.innerWidth >= 1180)
  const [isDesktop, setIsDesktop] = useState(typeof window === 'undefined' ? true : window.innerWidth >= 1180)
  const [openSections, setOpenSections] = useState({
    basics: true,
    axes: true,
    filters: true,
    imports: false,
  })

  const [newChartOpen, setNewChartOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [embedSettings, setEmbedSettings] = useState({
    variant: 'expanded',
    chartType: config?.chartType || 'bar',
    height: 860,
  })
  const [copied, setCopied] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [activeExportPreset, setActiveExportPreset] = useState('presentation')
  const [exportOptions, setExportOptions] = useState({
    header: true,
    subtitle: true,
    chart: true,
    stats: true,
    table: false,
    footer: true,
  })
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [snapshotName, setSnapshotName] = useState('')
  const [savedSnapshots, setSavedSnapshots] = useState(() => loadSavedSnapshots())
  const [dragIndex, setDragIndex] = useState(-1)
  const [dragOverIndex, setDragOverIndex] = useState(-1)
  const [historyPast, setHistoryPast] = useState([])
  const [historyFuture, setHistoryFuture] = useState([])
  const [pdfState, setPdfState] = useState({
    busy: false,
    message: '',
    fileName: '',
    years: [],
    rows: [],
    mode: 'top-year',
    year: '',
    topN: 20,
    includeZero: false,
    diagnosisId: '',
  })

  const chartRef = useRef(null)
  const exportPreviewRef = useRef(null)
  const historyMutedRef = useRef(false)
  const historyReadyRef = useRef(false)
  const previousSnapshotRef = useRef(null)
  const previousSnapshotSignatureRef = useRef('')

  const unitForms = useMemo(() => deriveUnitForms(unitBase), [unitBase])

  const normalizedData = useMemo(
    () =>
      rows
        .map((row) => ({
          label: String(row.label ?? '').trim(),
          value: parseNumber(row.value),
          color: row.color || '#78be20',
        }))
        .filter((row) => row.label),
    [rows],
  )

  const isYearSeries = normalizedData.length > 1 && normalizedData.every((row) => isYearLabel(row.label))

  const chartSourceData = useMemo(() => {
    const topN = Number.parseInt(quickFilters.topN, 10)
    let items = normalizedData.filter((row) => row.value >= 0)
    if (quickFilters.hideZero) items = items.filter((row) => row.value > 0)
    if (quickFilters.sortBy === 'value-desc') items = [...items].sort((a, b) => b.value - a.value)
    if (quickFilters.sortBy === 'value-asc') items = [...items].sort((a, b) => a.value - b.value)
    if (quickFilters.sortBy === 'label-asc') items = [...items].sort((a, b) => a.label.localeCompare(b.label, 'cs'))
    if (quickFilters.sortBy === 'label-desc') items = [...items].sort((a, b) => b.label.localeCompare(a.label, 'cs'))
    if (Number.isFinite(topN) && topN > 0) items = items.slice(0, topN)
    return items
  }, [normalizedData, quickFilters])

  const chartData = useMemo(
    () => (xDirection === 'reverse' && isYearSeries ? [...chartSourceData].reverse() : chartSourceData),
    [chartSourceData, xDirection, isYearSeries],
  )

  const stats = computeStats(chartData)
  const topItem = stats.max

  const embedPayload = useMemo(
    () => ({
      chartType: embedSettings.chartType,
      title,
      subtitle,
      sourceLabel,
      unitBase,
      barWidthScale,
      paletteId,
      rows: normalizedData,
      xDirection,
      xAxisLabel,
      yAxisLabel,
      annotationText,
      referenceLine,
      quickFilters,
    }),
    [embedSettings.chartType, title, subtitle, sourceLabel, unitBase, barWidthScale, paletteId, normalizedData, xDirection, xAxisLabel, yAxisLabel, annotationText, referenceLine, quickFilters],
  )

  const embedUrl = useMemo(() => {
    const payload = encodeEmbedConfig(embedPayload)
    return `${window.location.origin}${window.location.pathname}?mode=embed&variant=${embedSettings.variant}&cfg=${payload}`
  }, [embedPayload, embedSettings.variant])

  const iframeCode = useMemo(
    () => `<iframe src="${embedUrl}" width="100%" height="${embedSettings.height}" frameborder="0" loading="lazy"></iframe>`,
    [embedUrl, embedSettings.height],
  )

  const chartStateSnapshot = useMemo(
    () => ({
      chartType,
      title,
      subtitle,
      sourceLabel,
      unitBase,
      barWidthScale,
      paletteId,
      rows: cloneRows(rows),
      xDirection,
      xAxisLabel,
      yAxisLabel,
      annotationText,
      referenceLine: { ...referenceLine },
      quickFilters: sanitizeQuickFilters(quickFilters, chartType),
    }),
    [chartType, title, subtitle, sourceLabel, unitBase, barWidthScale, paletteId, rows, xDirection, xAxisLabel, yAxisLabel, annotationText, referenceLine, quickFilters],
  )

  const chartStateSignature = useMemo(() => JSON.stringify(chartStateSnapshot), [chartStateSnapshot])

  useEffect(() => {
    if (!historyReadyRef.current) {
      historyReadyRef.current = true
      previousSnapshotRef.current = chartStateSnapshot
      previousSnapshotSignatureRef.current = chartStateSignature
      return
    }
    if (historyMutedRef.current) {
      historyMutedRef.current = false
      previousSnapshotRef.current = chartStateSnapshot
      previousSnapshotSignatureRef.current = chartStateSignature
      return
    }
    if (chartStateSignature === previousSnapshotSignatureRef.current) return
    setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), previousSnapshotRef.current])
    setHistoryFuture([])
    previousSnapshotRef.current = chartStateSnapshot
    previousSnapshotSignatureRef.current = chartStateSignature
  }, [chartStateSnapshot, chartStateSignature])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const timeout = window.setTimeout(() => {
      setSavedSnapshots((prev) => {
        const autoSnapshot = {
          id: 'auto',
          name: 'Automatický snapshot',
          createdAt: new Date().toISOString(),
          state: chartStateSnapshot,
        }
        const rest = prev.filter((item) => item.id !== 'auto')
        return [autoSnapshot, ...rest].slice(0, SAVED_SNAPSHOT_LIMIT)
      })
    }, 1200)
    return () => window.clearTimeout(timeout)
  }, [chartStateSignature, chartStateSnapshot])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(savedSnapshots))
  }, [savedSnapshots])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!exportMessage) return undefined
    const timeout = window.setTimeout(() => setExportMessage(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [exportMessage])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    function handleResize() {
      const nextDesktop = window.innerWidth >= 1180
      setIsDesktop(nextDesktop)
      if (nextDesktop) setSidebarOpen(true)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    function handleKeyDown(event) {
      const key = String(event.key || '').toLowerCase()
      const isUndoRedo = (event.metaKey || event.ctrlKey) && key === 'z'
      if (!isUndoRedo) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return
      event.preventDefault()
      if (event.shiftKey) redoChange()
      else undoChange()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [historyPast, historyFuture, chartStateSnapshot])

  function setEmbedPatch(patch) {
    setEmbedSettings((prev) => ({ ...prev, ...patch }))
  }

  function applySnapshotState(nextState) {
    if (!nextState) return
    const nextChartType = nextState.chartType || 'bar'
    const nextPalette = nextState.paletteId || 'avenier-greens'
    const palette = getSchemeColors(nextPalette)
    const restoredRows = cloneRows(nextState.rows).map((row, index) => ({
      ...row,
      color: row.color || palette[index % palette.length] || '#78be20',
    }))
    historyMutedRef.current = true
    setChartType(nextChartType)
    setTitle(nextState.title || DEFAULT_TITLE)
    setSubtitle(nextState.subtitle || DEFAULT_SUBTITLE)
    setSourceLabel(nextState.sourceLabel || 'vlastní dataset')
    setUnitBase(nextState.unitBase || 'případ')
    setBarWidthScale(normalizeBarWidthScale(nextState.barWidthScale))
    setPaletteId(nextPalette)
    setRows(restoredRows)
    setXDirection(nextState.xDirection === 'reverse' ? 'reverse' : 'normal')
    setXAxisLabel(String(nextState.xAxisLabel || ''))
    setYAxisLabel(String(nextState.yAxisLabel || ''))
    setAnnotationText(String(nextState.annotationText || ''))
    setReferenceLine({
      enabled: Boolean(nextState.referenceLine?.enabled),
      value: nextState.referenceLine?.value ?? '',
      label: nextState.referenceLine?.label || 'Cíl',
    })
    setQuickFilters(sanitizeQuickFilters(nextState.quickFilters, nextChartType))
  }

  function undoChange() {
    if (!historyPast.length) return
    const previous = historyPast[historyPast.length - 1]
    setHistoryPast((prev) => prev.slice(0, -1))
    setHistoryFuture((prev) => [chartStateSnapshot, ...prev].slice(0, HISTORY_LIMIT))
    applySnapshotState(previous)
  }

  function redoChange() {
    if (!historyFuture.length) return
    const [next, ...rest] = historyFuture
    setHistoryFuture(rest)
    setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), chartStateSnapshot])
    applySnapshotState(next)
  }

  function saveSnapshot() {
    const fallbackTitle = title?.trim() || 'Graf'
    const name = snapshotName.trim() || `${fallbackTitle} · ${formatSnapshotDate(new Date().toISOString())}`
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: new Date().toISOString(),
      state: chartStateSnapshot,
    }
    setSavedSnapshots((prev) => {
      const rest = prev.filter((item) => item.id !== 'auto')
      const auto = prev.find((item) => item.id === 'auto')
      return [entry, auto, ...rest].filter(Boolean).slice(0, SAVED_SNAPSHOT_LIMIT)
    })
    setSnapshotName('')
    setExportMessage(`Graf uložen: ${name}`)
  }

  function restoreSnapshot(item) {
    if (!item?.state) return
    setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), chartStateSnapshot])
    setHistoryFuture([])
    applySnapshotState(item.state)
    setExportMessage(`Načten snapshot: ${item.name}`)
  }

  function deleteSnapshot(snapshotId) {
    setSavedSnapshots((prev) => prev.filter((item) => item.id !== snapshotId))
  }

  function restoreLatestSnapshot() {
    if (!savedSnapshots.length) return
    const latestManual = savedSnapshots.find((item) => item.id !== 'auto')
    restoreSnapshot(latestManual || savedSnapshots[0])
  }

  function saveCurrentChart() {
    const nextName = `${title?.trim() || 'Graf'} · ${formatSnapshotDate(new Date().toISOString())}`
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: nextName,
      createdAt: new Date().toISOString(),
      state: chartStateSnapshot,
    }
    setSavedSnapshots((prev) => {
      const rest = prev.filter((item) => item.id !== 'auto')
      const auto = prev.find((item) => item.id === 'auto')
      return [entry, auto, ...rest].filter(Boolean).slice(0, SAVED_SNAPSHOT_LIMIT)
    })
    setExportMessage(`Graf uložen: ${nextName}`)
  }

  function updateQuickFilter(key, value) {
    setQuickFilters((prev) => ({
      ...prev,
      [key]: key === 'topN' ? String(value).replace(/[^\d]/g, '') : value,
    }))
  }

  function resetQuickFilters() {
    setQuickFilters(getDefaultQuickFilters(chartType))
  }

  function toggleSection(sectionKey) {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
  }

  function reorderRows(fromIndex, toIndex) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    setRows((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  function handleRowDrop(targetIndex) {
    if (dragIndex < 0) return
    reorderRows(dragIndex, targetIndex)
    setDragIndex(-1)
    setDragOverIndex(-1)
  }

  function applyExportPreset(presetId) {
    const preset = EXPORT_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    setActiveExportPreset(presetId)
    setExportOptions({ ...preset.options })
  }

  function updateRow(index, key, value) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  function addRow() {
    const colors = getSchemeColors(paletteId)
    setRows((prev) => [
      ...prev,
      {
        label: `Kategorie ${prev.length + 1}`,
        value: 0,
        color: colors[prev.length % colors.length] || '#78be20',
      },
    ])
  }

  function deleteRow(index) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function handlePaletteSelect(nextPaletteId) {
    setPaletteId(nextPaletteId)
  }

  function applyPalette() {
    if (paletteId === 'custom') return
    setRows((prev) => applySchemeToRows(prev, paletteId))
  }

  function importObjects(objects, sourceLabel) {
    const mapped = mapObjectsToChartRows(objects, getSchemeColors(paletteId))
    if (!mapped.length) {
      setImportMessage(`Import (${sourceLabel}): nenašly se použitelné řádky.`)
      return
    }
    setRows(
      mapped.map((row, index) => ({
        ...row,
        color: row.color || getSchemeColors(paletteId)[index % getSchemeColors(paletteId).length],
      })),
    )
    setImportMessage(`Import (${sourceLabel}): načteno ${mapped.length} řádků.`)
  }

  function handleManualImport() {
    try {
      const objects = parseManualText(importText)
      importObjects(objects, 'text')
    } catch {
      setImportMessage('Import textu selhal. Zkontrolujte JSON/CSV formát.')
    }
  }

  async function handleTableFileUpload(file) {
    if (!file) return
    try {
      const objects = await parseTabularFile(file)
      importObjects(objects, file.name)
    } catch (error) {
      setImportMessage(`Import souboru selhal: ${error?.message || 'neznámá chyba'}`)
    }
  }

  async function handlePdfUpload(file) {
    if (!file) return
    setPdfState((prev) => ({ ...prev, busy: true, fileName: file.name, message: '' }))
    try {
      const parsed = await parseUzisYearlyPdf(file)
      if (!parsed.rows.length) {
        setPdfState((prev) => ({ ...prev, busy: false, message: 'V PDF nebyly nalezeny použitelné řádky.', rows: [] }))
        return
      }
      setPdfState((prev) => ({
        ...prev,
        busy: false,
        years: parsed.years,
        rows: parsed.rows,
        year: parsed.years[parsed.years.length - 1] || '',
        diagnosisId: parsed.rows[0]?.id || '',
        message: `PDF načteno: ${parsed.rows.length} diagnóz, období ${parsed.period || 'n/a'}.`,
      }))
    } catch (error) {
      setPdfState((prev) => ({ ...prev, busy: false, message: `PDF import selhal: ${error?.message || 'neznámá chyba'}` }))
    }
  }

  function updatePdfState(patch) {
    setPdfState((prev) => ({ ...prev, ...patch }))
  }

  function applyPdfImport() {
    if (!pdfState.rows.length) return
    if (pdfState.mode === 'timeline') {
      const timeline = buildDiagnosisTimelineRows({ rows: pdfState.rows, years: pdfState.years }, pdfState.diagnosisId)
      if (!timeline.length) {
        setPdfState((prev) => ({ ...prev, message: 'Vybraná diagnóza nemá data pro časovou osu.' }))
        return
      }
      setChartType('line')
      setRows(timeline.map((row, index) => ({ ...row, color: getSchemeColors(paletteId)[index % getSchemeColors(paletteId).length] })))
      const diagnosis = pdfState.rows.find((row) => row.id === pdfState.diagnosisId)
      setTitle(diagnosis ? `${diagnosis.code} ${diagnosis.diagnosis}` : 'Vývoj diagnózy')
      setSubtitle('Časová řada z tabulky ÚZIS')
      setXAxisLabel('Rok')
      setYAxisLabel('Hodnota')
      setAnnotationText('')
      setReferenceLine({ enabled: false, value: '', label: 'Cíl' })
      setXDirection('normal')
      setQuickFilters(getDefaultQuickFilters('line'))
      setPdfState((prev) => ({ ...prev, message: 'PDF import aplikován (timeline).' }))
      return
    }

    const topRows = buildTopDiagnosisRows(
      { rows: pdfState.rows, years: pdfState.years },
      { year: pdfState.year, topN: Number(pdfState.topN || 20), includeZero: pdfState.includeZero },
    )
    if (!topRows.length) {
      setPdfState((prev) => ({ ...prev, message: 'Pro zvolený rok nebyla nalezena data.' }))
      return
    }
    setChartType('bar')
    setRows(topRows.map((row, index) => ({ ...row, color: getSchemeColors(paletteId)[index % getSchemeColors(paletteId).length] })))
    setTitle(`Top diagnózy (${pdfState.year})`)
    setSubtitle('Srovnání dle roční tabulky ÚZIS')
    setXAxisLabel('Kategorie')
    setYAxisLabel('Hodnota')
    setAnnotationText('')
    setReferenceLine({ enabled: false, value: '', label: 'Cíl' })
    setQuickFilters(getDefaultQuickFilters('bar'))
    setPdfState((prev) => ({ ...prev, message: `PDF import aplikován (${topRows.length} řádků).` }))
  }

  function createNewChart(payload) {
    if (normalizedData.length) saveCurrentChart()
    const colors = getSchemeColors(paletteId)
    if (payload.chartType === 'line') {
      setRows([
        { label: '2021', value: 20, color: colors[0] },
        { label: '2022', value: 35, color: colors[1] },
        { label: '2023', value: 52, color: colors[2] },
        { label: '2024', value: 47, color: colors[3] },
        { label: '2025', value: 63, color: colors[4] },
        { label: '2026', value: 58, color: colors[5] },
      ])
    } else {
      setRows(buildSampleRows(colors))
    }
    setChartType(payload.chartType)
    setTitle(payload.title || 'Nový graf')
    setSubtitle(payload.subtitle || 'Doplňte data a exportujte výstup')
    setSourceLabel('vlastní dataset')
    setBarWidthScale(54)
    setXAxisLabel(payload.chartType === 'line' ? 'Rok' : payload.chartType === 'pie' ? '' : 'Kategorie')
    setYAxisLabel(payload.chartType === 'pie' ? '' : 'Hodnota')
    setAnnotationText('')
    setReferenceLine({ enabled: false, value: '', label: 'Cíl' })
    setQuickFilters(getDefaultQuickFilters(payload.chartType))
    setImportMessage('')
    setNewChartOpen(false)
    setWorkspaceView('data')
    setSidebarOpen(true)
  }

  function toggleExportOption(key) {
    setActiveExportPreset('custom')
    setExportOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function exportFromElement(format) {
    if (!exportPreviewRef.current) return
    try {
      setExportMessage(`Generuji ${format.toUpperCase()}...`)
      // Exportní knihovny se načítají až při prvním exportu (menší úvodní bundle).
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(exportPreviewRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#ffffff',
      })
      if (format === 'png') {
        const link = document.createElement('a')
        link.download = `${slugify(title) || 'epi-graf'}-${chartType}.png`
        link.href = dataUrl
        link.click()
        setExportMessage('PNG export hotový.')
        return
      }
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 10
      const props = pdf.getImageProperties(dataUrl)
      const imgWidth = pageWidth - margin * 2
      const imgHeight = (props.height * imgWidth) / props.width
      const printableHeight = pageHeight - margin * 2

      // Alias „chart“ vloží obrázek do PDF jen jednou i při více stránkách, FAST zapne kompresi.
      let offsetY = 0
      pdf.addImage(dataUrl, 'PNG', margin, margin - offsetY, imgWidth, imgHeight, 'chart', 'FAST')
      offsetY += printableHeight

      while (offsetY < imgHeight) {
        pdf.addPage()
        pdf.addImage(dataUrl, 'PNG', margin, margin - offsetY, imgWidth, imgHeight, 'chart', 'FAST')
        offsetY += printableHeight
      }
      pdf.save(`${slugify(title) || 'epi-graf'}.pdf`)
      setExportMessage('PDF export hotový.')
    } catch (error) {
      setExportMessage(`Export se nezdařil: ${error?.message || 'neznámá chyba'}`)
    }
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('')
    }
  }

  const chartNameMap = {
    bar: 'Klasický sloupcový',
    pie: 'Koláčový',
    line: 'Liniový',
    hbar: 'Vodorovný sloupcový',
  }

  if (embedMode) {
    const compact = embedVariant === 'compact'
    return (
      <div className="embedWrap">
        <div className="card">
          <div className="cardHeader">
            <div className="cardMeta">
              <h2 className="cardTitle">{title}</h2>
              {subtitle && !compact ? <p className="cardDesc">{subtitle}</p> : null}
            </div>
            <AvenierLogo size={26} />
          </div>
          <div className="cardBody" ref={chartRef}>
            <ChartFrame
              title={title}
              subtitle={compact ? '' : subtitle}
              chartType={config?.chartType || chartType}
              data={chartData}
              unitForms={unitForms}
              referenceLine={referenceLine}
              annotationText={compact ? '' : annotationText}
              xAxisLabel={compact ? '' : xAxisLabel}
              yAxisLabel={compact ? '' : yAxisLabel}
              barWidthScale={barWidthScale}
            />
          </div>
          {!compact ? (
            <div className="cardStats">
              <StatsPanel data={chartData} unitForms={unitForms} />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const sidebarContent = (
    <div className="sidebarStack">
      <div className="sidebarIntro panel">
        <div className="sidebarIntroHead">
          <div>
            <h3>Panel grafu</h3>
            <p>Upravujte data a vzhled bokem, náhled zůstane čistý.</p>
          </div>
          <div className="sidebarPills">
            <span>{rows.length} řádků</span>
            <span>{chartData.length} v grafu</span>
          </div>
        </div>
      </div>

      <AccordionSection title="Základ grafu" open={openSections.basics} onToggle={() => toggleSection('basics')} badge={chartNameMap[chartType]}>
        <label>
          Typ grafu
          <select value={chartType} onChange={(event) => setChartType(event.target.value)}>
            <option value="bar">Klasický sloupcový</option>
            <option value="hbar">Vodorovný sloupcový</option>
            <option value="pie">Koláčový</option>
            <option value="line">Liniový</option>
          </select>
        </label>

        <label>
          Název grafu
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Například Přehled případů" />
        </label>

        <label>
          Podnadpis
          <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Například Data za leden 2026" />
        </label>

        <label>
          Zdroj dat
          <input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="Např. ÚZIS, interní dashboard, vlastní sběr" />
        </label>

        {chartType === 'bar' || chartType === 'hbar' ? (
          <div className="rangeField">
            <div className="rangeFieldHeader">
              <span>Šířka sloupců</span>
              <strong>{barWidthScale} %</strong>
            </div>
            <input type="range" min="35" max="95" step="1" value={barWidthScale} onChange={(event) => setBarWidthScale(normalizeBarWidthScale(event.target.value))} />
            <p className="helperText">Podobně jako ve Flourish: nižší hodnota přidá rozestup, vyšší sloupce opticky zahustí.</p>
          </div>
        ) : null}

        <div className="paletteBox">
          <label>
            Barevné schéma
            <select value={paletteId} onChange={(event) => handlePaletteSelect(event.target.value)}>
              {COLOR_SCHEMES.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}
            </select>
          </label>
          <button className="btnSecondary" onClick={applyPalette} disabled={paletteId === 'custom'}>Použít schéma na všechny řádky</button>
          <div className="palettePreview">
            {getSchemeColors(paletteId).map((color) => <span key={color} className="paletteSwatch" style={{ background: color }} />)}
          </div>
        </div>
      </AccordionSection>

      <AccordionSection title="Osy a anotace" open={openSections.axes} onToggle={() => toggleSection('axes')} badge={chartType === 'pie' ? 'bez os' : 'osy'}>
        {chartType !== 'pie' ? (
          <>
            <div className="inlineRow twoCols">
              <label>
                Osa X
                <input value={xAxisLabel} onChange={(event) => setXAxisLabel(event.target.value)} placeholder="Kategorie" />
              </label>
              <label>
                Osa Y
                <input value={yAxisLabel} onChange={(event) => setYAxisLabel(event.target.value)} placeholder="Hodnota" />
              </label>
            </div>

            {isYearSeries ? (
              <label>
                Roky zleva
                <select value={xDirection} onChange={(event) => setXDirection(event.target.value)}>
                  <option value="normal">Nejstarší → nejnovější</option>
                  <option value="reverse">Nejnovější → nejstarší</option>
                </select>
              </label>
            ) : null}

            <div className="inlineRow twoCols">
              <label className="checkboxRow withTopPad">
                <input type="checkbox" checked={referenceLine.enabled} onChange={(event) => setReferenceLine((prev) => ({ ...prev, enabled: event.target.checked }))} />
                <span>Referenční čára</span>
              </label>
              <label>
                Popisek čáry
                <input value={referenceLine.label} onChange={(event) => setReferenceLine((prev) => ({ ...prev, label: event.target.value }))} placeholder="Cíl" />
              </label>
            </div>

            <label>
              Hodnota referenční čáry
              <input value={referenceLine.value} inputMode="decimal" onChange={(event) => setReferenceLine((prev) => ({ ...prev, value: event.target.value }))} placeholder="např. 120" disabled={!referenceLine.enabled} />
            </label>
            {referenceLine.enabled && !parseNumber(referenceLine.value) ? <p className="helperText">Referenční čára se zobrazí po zadání kladné hodnoty.</p> : null}
          </>
        ) : (
          <p className="helperText">Koláčový graf nepoužívá osy ani referenční čáru.</p>
        )}

        <label>
          Poznámka pod graf
          <textarea rows={2} value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} placeholder="Např. Data zahrnují pouze potvrzené případy." />
        </label>
      </AccordionSection>

      <AccordionSection title="Data a filtry" open={openSections.filters} onToggle={() => toggleSection('filters')} badge={`${rows.length} řádků`}>
        <label>
          Řazení v grafu
          <select value={quickFilters.sortBy} onChange={(event) => updateQuickFilter('sortBy', event.target.value)}>
            <option value="manual">Původní pořadí</option>
            <option value="value-desc">Hodnota: od nejvyšší</option>
            <option value="value-asc">Hodnota: od nejnižší</option>
            <option value="label-asc">Název: A-Z</option>
            <option value="label-desc">Název: Z-A</option>
          </select>
        </label>

        <div className="inlineRow twoCols">
          <label>
            Top N
            <input type="number" min="1" max="500" value={quickFilters.topN} onChange={(event) => updateQuickFilter('topN', event.target.value)} placeholder="Vše" />
          </label>
          <label className="checkboxRow withTopPad">
            <input type="checkbox" checked={quickFilters.hideZero} onChange={(event) => updateQuickFilter('hideZero', event.target.checked)} />
            <span>Skrýt nulové hodnoty</span>
          </label>
        </div>

        <div className="quickActions">
          <button className="btnSecondary" onClick={resetQuickFilters}>Reset filtru</button>
          <button className="btnSecondary" onClick={() => setWorkspaceView('data')}>Otevřít data</button>
        </div>

        <div className="quickActions">
          <button className="btnSecondary" onClick={() => setRows(buildSampleRows(getSchemeColors(paletteId)))}>Načíst ukázku</button>
          <button className="btnSecondary" onClick={addRow}>Přidat řádek</button>
          <button className="btnSecondary" onClick={() => setRows([])}>Vyčistit</button>
        </div>
      </AccordionSection>

      <AccordionSection title="Import" open={openSections.imports} onToggle={() => toggleSection('imports')} badge="CSV, Excel, PDF">
        <section className="importCard">
          <label>
            Ruční import
            <textarea rows={5} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'např.\nPraha 1\nBrno 5'} />
          </label>
          <div className="quickActions">
            <button className="btnSecondary" onClick={handleManualImport}>Importovat text</button>
            <label className="fileBtn compact">
              CSV/Excel
              <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => handleTableFileUpload(event.target.files?.[0])} />
            </label>
          </div>
          {importMessage ? <p className="helperText">{importMessage}</p> : null}
        </section>
        <PdfImportBox state={pdfState} onUpload={handlePdfUpload} onChange={updatePdfState} onApply={applyPdfImport} />
      </AccordionSection>

    </div>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="left">
          <div className="logo"><AvenierLogo size={30} /></div>
          <div className="divider" />
          <div className="appName">
            <span className="appNameMain">Epidemiologické grafy</span>
            <span className="appNameSub">Avenier - sloupcový, koláčový, liniový i vodorovný graf</span>
          </div>
        </div>
        <div className="center">
          <div className="datasetTabs" role="tablist" aria-label="Pracovní režim">
            <button className={`datasetTab ${workspaceView === 'preview' ? 'datasetTabActive' : ''}`} onClick={() => setWorkspaceView('preview')}>
              <span className="datasetTabLabel">Náhled</span>
              <span className="datasetTabPeriod">Graf a výstup</span>
            </button>
            <button className={`datasetTab ${workspaceView === 'data' ? 'datasetTabActive' : ''}`} onClick={() => setWorkspaceView('data')}>
              <span className="datasetTabLabel">Data</span>
              <span className="datasetTabPeriod">Tabulka a vstupy</span>
            </button>
          </div>
        </div>
        <div className="right">
          <button className="btnSecondary toolbarBtn" onClick={() => setNewChartOpen(true)}>
            <span className="btnIcon"><ToolbarIcon name="new" /></span>
            <span className="btnText">Nový graf</span>
          </button>
          <button className="btnSecondary toolbarBtn" onClick={saveCurrentChart}>
            <span className="btnIcon"><ToolbarIcon name="save" /></span>
            <span className="btnText">Uložit graf</span>
          </button>
          <button className="btnSecondary toolbarBtn" onClick={() => setHistoryOpen(true)}>
            <span className="btnIcon"><ToolbarIcon name="history" /></span>
            <span className="btnText">Historie</span>
          </button>
          <button className="exportBtn toolbarBtn" onClick={() => setExportOpen(true)}>
            <span className="btnIcon"><ToolbarIcon name="export" /></span>
            <span className="btnText">Export</span>
          </button>
          <button className="exportBtn toolbarBtn" onClick={() => setEmbedOpen(true)}>
            <span className="btnIcon"><ToolbarIcon name="embed" /></span>
            <span className="btnText">Embed</span>
          </button>
          <button className="editBtn toolbarBtn" onClick={() => setSidebarOpen((prev) => !prev)}>
            <span className="btnIcon"><ToolbarIcon name="panel" /></span>
            <span className="btnText">{sidebarOpen ? 'Skrýt panel' : 'Zobrazit panel'}</span>
          </button>
        </div>
      </header>

      <main className={`main workspaceMainLayout ${isDesktop && sidebarOpen ? 'withSidebar' : 'withoutSidebar'}`}>
        <section className="workspaceMain">
          {workspaceView === 'preview' ? (
            <div className="chartSection">
              <div className="kpiRow">
                <div className="kpi">
                  <div className="kpiValue">{formatNumber(stats.total)}</div>
                  <div className="kpiLabel">Celkem {inflectUnit(stats.total, unitForms)}</div>
                </div>
                <div className="kpi">
                  <div className="kpiValue">{chartData.length}</div>
                  <div className="kpiLabel">Aktivní kategorie</div>
                </div>
                <div className="kpiMeta">
                  Nejvyšší hodnota: <strong>{topItem ? topItem.label : '-'}</strong>
                  <br />
                  <span>{topItem ? formatValueWithUnit(topItem.value, unitForms) : '-'}</span>
                </div>
              </div>

              <div className="workspaceSummary panel">
                <div className="workspaceSummaryText">
                  <h3>{title}</h3>
                  <p>{subtitle}</p>
                </div>
                <div className="workspaceSummaryMeta">
                  <span>{chartNameMap[chartType]}</span>
                  <span>{rows.length} zdrojových řádků</span>
                  {quickFilters.topN ? <span>Top {quickFilters.topN}</span> : null}
                </div>
              </div>

              <div className="panel chartPanel" ref={chartRef}>
                <ChartFrame
                  title={title}
                  subtitle={subtitle}
                  chartType={chartType}
                  data={chartData}
                  unitForms={unitForms}
                  referenceLine={referenceLine}
                  annotationText={annotationText}
                  xAxisLabel={xAxisLabel}
                  yAxisLabel={yAxisLabel}
                  barWidthScale={barWidthScale}
                />
              </div>

              <StatsPanel data={chartData} unitForms={unitForms} />
            </div>
          ) : (
            <section className="dataWorkspace panel">
              <div className="dataWorkspaceHead">
                <div>
                  <h2>Data</h2>
                  <p>Upravte zdrojová data grafu v přehledu podobném spreadsheetu.</p>
                </div>
                <div className="editorModeSwitch">
                  <button className={`modeChip ${editorDataView === 'form' ? 'active' : ''}`} onClick={() => setEditorDataView('form')}>Formulář</button>
                  <button className={`modeChip ${editorDataView === 'table' ? 'active' : ''}`} onClick={() => setEditorDataView('table')}>Tabulka</button>
                </div>
              </div>

              <div className="dataWorkspaceToolbar">
                <button className="btnSecondary" onClick={() => setRows(buildSampleRows(getSchemeColors(paletteId)))}>Načíst ukázku</button>
                <button className="btnSecondary" onClick={addRow}>Přidat řádek</button>
                <button className="btnSecondary" onClick={() => setRows([])}>Vyčistit</button>
              </div>

              {editorDataView === 'form' ? (
                <>
                  <div className="valuesHeader">
                    <div>↕</div>
                    <div>Kategorie</div>
                    <div>Hodnota</div>
                    <div>Barva</div>
                  </div>
                  <div className="rowsList dataRowsList">
                    {rows.map((row, index) => (
                      <article
                        key={`row-${index}`}
                        className={`valueRow ${dragIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'dragOver' : ''}`}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDragOverIndex(index)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          handleRowDrop(index)
                        }}
                        onDragEnd={() => {
                          setDragIndex(-1)
                          setDragOverIndex(-1)
                        }}
                      >
                        <button className="dragHandle" title="Přetáhněte pro změnu pořadí" type="button">::</button>
                        <input className="colName" value={row.label} onChange={(event) => updateRow(index, 'label', event.target.value)} placeholder="Název" />
                        <input className="colNum" value={row.value} inputMode="decimal" onChange={(event) => updateRow(index, 'value', event.target.value)} />
                        <div className="colorActions">
                          <input className="colorInput" type="color" value={row.color} onChange={(event) => updateRow(index, 'color', event.target.value)} />
                          <button className="rowDelete" onClick={() => deleteRow(index)} title="Odebrat kategorii">×</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="dataGridWrap">
                  <table className="dataGrid">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Kategorie</th>
                        <th>Hodnota</th>
                        <th>Barva</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`grid-row-${index}`}>
                          <td>{index + 1}</td>
                          <td><input value={row.label} onChange={(event) => updateRow(index, 'label', event.target.value)} placeholder="Název" /></td>
                          <td><input value={row.value} inputMode="decimal" onChange={(event) => updateRow(index, 'value', event.target.value)} /></td>
                          <td><input className="colorInput" type="color" value={row.color} onChange={(event) => updateRow(index, 'color', event.target.value)} /></td>
                          <td><button className="rowDelete" onClick={() => deleteRow(index)} title="Odebrat kategorii">×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </section>

        {isDesktop && sidebarOpen ? <aside className="workspaceSidebar">{sidebarContent}</aside> : null}
      </main>

      <footer className="footer">
        <span>Nástroj pro rychlou tvorbu grafu (manuální vstup, CSV/Excel, PDF ÚZIS)</span>
        <span className="footerRight">© Avenier</span>
      </footer>

      {!isDesktop ? (
        <EditorDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          {sidebarContent}
        </EditorDrawer>
      ) : null}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        options={exportOptions}
        onToggle={toggleExportOption}
        onApplyPreset={applyExportPreset}
        activePreset={activeExportPreset}
        previewRef={exportPreviewRef}
        onExportPng={() => exportFromElement('png')}
        onExportPdf={() => exportFromElement('pdf')}
        context={{ chartName: chartNameMap[chartType], count: chartData.length, sourceLabel }}
      >
        <div className="exportSnapshot">
          {exportOptions.header ? (
            <div className="snapshotHeader">
              <div>
                <h2>{title}</h2>
                {exportOptions.subtitle && subtitle ? <p>{subtitle}</p> : null}
              </div>
              <AvenierLogo size={24} />
            </div>
          ) : null}
          {exportOptions.chart ? <ChartRenderer chartType={chartType} data={chartData} unitForms={unitForms} referenceLine={referenceLine} xAxisLabel={xAxisLabel} yAxisLabel={yAxisLabel} renderMode="export" barWidthScale={barWidthScale} /> : null}
          {exportOptions.chart && annotationText ? <p className="chartNote">{annotationText}</p> : null}
          {exportOptions.stats ? <StatsPanel data={chartData} unitForms={unitForms} /> : null}
          {exportOptions.table ? (
            <div className="snapshotTableWrap">
              <table className="snapshotTable">
                <thead>
                  <tr><th>Kategorie</th><th>Hodnota</th></tr>
                </thead>
                <tbody>
                  {chartData.map((row) => (
                    <tr key={row.label}><td>{row.label}</td><td>{formatValueWithUnit(row.value, unitForms)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {exportOptions.footer ? <div className="snapshotFooter">Zdroj: {sourceLabel || 'vlastní dataset'} · © Avenier</div> : null}
        </div>
      </ExportModal>

      <EmbedModal
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        settings={embedSettings}
        onSettingsChange={setEmbedPatch}
        embedUrl={embedUrl}
        iframeCode={iframeCode}
        onCopyUrl={() => copyText(embedUrl, 'url')}
        onCopyIframe={() => copyText(iframeCode, 'iframe')}
        copied={copied}
      />

      <NewChartModal open={newChartOpen} onClose={() => setNewChartOpen(false)} onCreate={createNewChart} />
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        historyPast={historyPast}
        historyFuture={historyFuture}
        onUndo={undoChange}
        onRedo={redoChange}
        snapshotName={snapshotName}
        onSnapshotNameChange={setSnapshotName}
        onSaveSnapshot={saveSnapshot}
        onLoadLast={restoreLatestSnapshot}
        savedSnapshots={savedSnapshots}
        onRestoreSnapshot={restoreSnapshot}
        onDeleteSnapshot={deleteSnapshot}
      />
      {exportMessage ? <div className="toastMessage">{exportMessage}</div> : null}
    </div>
  )
}
