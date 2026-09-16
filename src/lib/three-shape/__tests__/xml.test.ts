import { describe, expect, it } from 'vitest'
import { decodeEntities, parseXml, walk, childrenNamed } from '../xml'

describe('decodeEntities', () => {
  it('decodes the named subset and numeric entities', () => {
    expect(decodeEntities('a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;')).toBe(`a <b> & "c" 'd'`)
    expect(decodeEntities('line1&#xA;line2')).toBe('line1\nline2')
    expect(decodeEntities('&#65;&#66;')).toBe('AB')
  })
  it('leaves unknown entities untouched and is a no-op without "&"', () => {
    expect(decodeEntities('plain text')).toBe('plain text')
    expect(decodeEntities('&unknownthing;')).toBe('&unknownthing;')
  })
})

describe('parseXml', () => {
  it('parses attribute-only elements into a tree', () => {
    const root = parseXml(
      `<?xml version="1.0"?><Object name="OrderList" type="TDM_List_Order"><List name="Items"><Object type="TDM_Item_Order"><Property name="IntOrderID" value="X_1"/><Property name="Items" value="Crown 14"/></Object></List></Object>`,
    )
    const objects = [...walk(root)].filter((n) => n.name === 'Object')
    expect(objects[0].attrs.name).toBe('OrderList')
    const props = [...walk(root)].filter((n) => n.name === 'Property')
    expect(props.map((p) => p.attrs.name)).toEqual(['IntOrderID', 'Items'])
    expect(props[0].attrs.value).toBe('X_1')
  })

  it('tolerates mismatched / stray closing tags without throwing', () => {
    const root = parseXml('<a><b><c/></d></b></a>')
    expect(childrenNamed(root, 'a')).toHaveLength(1)
    expect(root.children[0].children[0].name).toBe('b')
  })

  it('handles empty and comment-only input', () => {
    expect(parseXml('').children).toHaveLength(0)
    expect(parseXml('<!-- nothing here --><!DOCTYPE x>').children).toHaveLength(0)
  })

  it('decodes entities inside attribute values', () => {
    const root = parseXml('<P v="a &amp; b&#xA;c"/>')
    expect(root.children[0].attrs.v).toBe('a & b\nc')
  })
})
