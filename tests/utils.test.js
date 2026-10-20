import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatNumber, inflectUnit, parseNumber, slugify } from '../src/utils/czech.js'
import { decodeEmbedConfig, encodeEmbedConfig } from '../src/utils/embed.js'
import { mapObjectsToChartRows, parseManualText } from '../src/utils/importers.js'

const PRIPAD = { one: 'případ', few: 'případy', many: 'případů' }

test('parseNumber přijímá desetinnou čárku a mezery', () => {
  assert.equal(parseNumber('1 234,5'), 1234.5)
  assert.equal(parseNumber(''), 0)
  assert.equal(parseNumber(null), 0)
})

test('formatNumber používá český formát', () => {
  assert.equal(formatNumber(1234.56).replace(/\s/g, ' '), '1 234,6')
  assert.equal(formatNumber('abc'), '0')
})

test('inflectUnit skloňuje podle počtu', () => {
  assert.equal(inflectUnit(1, PRIPAD), 'případ')
  assert.equal(inflectUnit(3, PRIPAD), 'případy')
  assert.equal(inflectUnit(5, PRIPAD), 'případů')
  assert.equal(inflectUnit(1.5, PRIPAD), 'případů')
})

test('slugify odstraní diakritiku', () => {
  assert.equal(slugify('Žluťoučký kůň 2026'), 'zlutoucky-kun-2026')
})

test('embed konfigurace přežije encode/decode včetně diakritiky', () => {
  const config = { title: 'Klíšťová encefalitida', rows: [{ label: 'Praha', value: 12 }] }
  assert.deepEqual(decodeEmbedConfig(encodeEmbedConfig(config)), config)
  assert.equal(decodeEmbedConfig('%%%nevalidni'), null)
  assert.equal(decodeEmbedConfig(''), null)
})

test('parseManualText zvládne CSV se středníkem i JSON objekt', () => {
  const csv = parseManualText('nazev;hodnota\nA;1\nB;2,5')
  const rows = mapObjectsToChartRows(csv, ['#000000'])
  assert.deepEqual(
    rows.map((r) => [r.label, r.value]),
    [
      ['A', 1],
      ['B', 2.5],
    ],
  )
  const fromJson = mapObjectsToChartRows(parseManualText('{"X": 4, "Y": {"value": 7, "color": "#ff0000"}}'))
  assert.deepEqual(fromJson[1], { label: 'Y', value: 7, color: '#ff0000' })
})
