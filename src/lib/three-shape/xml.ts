/**
 * Minimal, dependency-free XML reader.
 *
 * 3Shape order files (`<order>.xml`, `Materials.xml`, `SID_UserInputData.XML`)
 * are plain attribute-only XML — no mixed content, no namespaces that matter.
 * A small tokenizer is enough, and keeps this module installable-free.
 *
 * TypeScript port of `scripts/case-xml-extract/lib/xml.mjs` — behaviour must
 * stay identical; the drift-guard test (see xml-work-plan.md §15.4) runs both
 * over `case_data/` and asserts equal output.
 *
 * SECURITY: this is NOT a general XML parser. It decodes only the fixed entity
 * subset below (named `lt/gt/amp/quot/apos` plus numeric). There is no DTD
 * processing, no external entities, no entity expansion — so no XXE and no
 * billion-laughs surface. Do not swap in a full XML library without a security
 * review (xml-work-plan.md §14).
 */

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

const TOKEN = new RegExp(
  [
    '<\\?[\\s\\S]*?\\?>', // prolog
    '<!--[\\s\\S]*?-->', // comment
    '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>', // cdata
    '<![\\s\\S]*?>', // doctype
    '<\\/([A-Za-z_][\\w.:-]*)\\s*>', // close
    '<([A-Za-z_][\\w.:-]*)((?:\\s+[\\w.:-]+\\s*=\\s*"[^"]*")*)\\s*(\\/?)>', // open / self-close
  ].join('|'),
  'g',
)

const ATTR = /([\w.:-]+)\s*=\s*"([^"]*)"/g

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Decode the entity subset 3Shape emits (incl. `&#xA;` inside OrderComments). */
export function decodeEntities(value: string): string {
  if (!value || value.indexOf('&') === -1) return value
  return value.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

function parseAttrs(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!raw) return attrs
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(raw))) attrs[m[1]] = decodeEntities(m[2])
  return attrs
}

/**
 * @returns synthetic root whose children are the document's top-level elements
 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [] }
  const stack: XmlNode[] = [root]
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(source))) {
    const closeName = m[1]
    const openName = m[2]
    const rawAttrs = m[3]
    const selfClosing = m[4]
    if (closeName) {
      // Tolerate stray/mismatched closers rather than throwing on a 40MB file.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === closeName) {
          stack.length = i
          break
        }
      }
    } else if (openName) {
      const node: XmlNode = { name: openName, attrs: parseAttrs(rawAttrs), children: [] }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
    }
  }
  return root
}

/** Depth-first walk over every element node. */
export function* walk(node: XmlNode): Generator<XmlNode> {
  for (const child of node.children) {
    yield child
    yield* walk(child)
  }
}

/** First descendant matching `predicate`, or null. */
export function find(node: XmlNode, predicate: (el: XmlNode) => boolean): XmlNode | null {
  for (const el of walk(node)) if (predicate(el)) return el
  return null
}

/** Direct children named `name`. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name)
}
