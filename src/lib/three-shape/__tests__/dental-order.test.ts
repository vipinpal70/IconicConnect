import { describe, expect, it } from 'vitest'
import {
  archOf,
  archesOf,
  countOrderRecords,
  parseOrder,
  parseScanSettings,
  UNN_TO_FDI,
  unixToIso,
} from '../dental-order'
import { buildOrderXml } from './_zipfix'

describe('tooth numbering', () => {
  it('UNN → FDI matches the verified table', () => {
    expect(UNN_TO_FDI[5]).toBe(14) // "Crown 14" (FDI) is actually UNN 5
    expect(UNN_TO_FDI[12]).toBe(24)
    expect(UNN_TO_FDI[19]).toBe(36)
  })
  it('archOf / archesOf', () => {
    expect(archOf(8)).toBe('Upper')
    expect(archOf(24)).toBe('Lower')
    expect(archOf(99)).toBeNull()
    expect(archesOf([2, 3, 4])).toBe('Upper')
    expect(archesOf([18, 19])).toBe('Lower')
    expect(archesOf([3, 30])).toBe('Both Arches')
    expect(archesOf([])).toBeNull()
  })
})

describe('unixToIso', () => {
  it('treats the value as epoch seconds', () => {
    expect(unixToIso('1788525019')).toBe(new Date(1788525019 * 1000).toISOString())
    expect(unixToIso('0')).toBeNull()
    expect(unixToIso('')).toBeNull()
    expect(unixToIso(undefined)).toBeNull()
  })
})

describe('parseOrder', () => {
  it('reads tooth numbers from ToothElement, not the Items text', () => {
    const xml = buildOrderXml([{ unn: 5, cls: 'teCrown' }], { items: 'Crown 14' })
    const parsed = parseOrder(xml)
    expect(parsed.units.map((u) => u.unn)).toEqual([5])
    expect(parsed.order.itemsSummary).toBe('Crown 14') // raw text preserved
  })

  it('recovers a 3-unit bridge span via connector links (union-find)', () => {
    const xml = buildOrderXml(
      [
        { unn: 12, cls: 'teCrown' },
        { unn: 13, cls: 'teCrownPontic' },
        { unn: 14, cls: 'teCrown' },
      ],
      { items: 'Anatomy bridge 24-26', connectors: [[12, 13], [13, 14]] },
    )
    const parsed = parseOrder(xml)
    expect(parsed.hasConnector).toBe(true)
    expect(parsed.connectorGroups).toEqual([[12, 13, 14]])
  })

  it('counts the order records (Q4 guard)', () => {
    expect(countOrderRecords(buildOrderXml([{ unn: 5, cls: 'teCrown' }]))).toBe(1)
    expect(
      countOrderRecords(buildOrderXml([{ unn: 5, cls: 'teCrown' }], { orderRecords: 2 })),
    ).toBe(2)
  })
})

describe('parseScanSettings', () => {
  it('pulls booleans and MainStepDie tooth numbers', () => {
    const sid = `<Root>
      <DataReference Id="IsArticulatorHolderUsed"><Data><Content Value="True"/></Data></DataReference>
      <DataReference Id="CloseBottomHole"><Data><Content Value="False"/></Data></DataReference>
      <NameSpace Id="MainStepDie 12"/>
      <NameSpace Id="MainStepDie 14"/>
    </Root>`
    const s = parseScanSettings(sid)
    expect(s?.articulatorUsed).toBe(true)
    expect(s?.closedBottom).toBe(false)
    expect(s?.dieTeeth).toEqual([12, 14])
  })
  it('returns null when there is no SID file', () => {
    expect(parseScanSettings(null)).toBeNull()
  })
})
