/**
 * Minimal, dependency-free XML reader.
 *
 * 3Shape order files (`<order>.xml`, `Materials.xml`, `SID_UserInputData.XML`)
 * are plain attribute-only XML — no mixed content, no namespaces that matter.
 * That makes a small tokenizer enough and keeps this toolkit installable-free.
 */

const TOKEN = new RegExp(
  [
    '<\\?[\\s\\S]*?\\?>',            // prolog
    '<!--[\\s\\S]*?-->',             // comment
    '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',// cdata
    '<![\\s\\S]*?>',                 // doctype
    '<\\/([A-Za-z_][\\w.:-]*)\\s*>', // close
    '<([A-Za-z_][\\w.:-]*)((?:\\s+[\\w.:-]+\\s*=\\s*"[^"]*")*)\\s*(\\/?)>', // open / self-close
  ].join('|'),
  'g'
)

const ATTR = /([\w.:-]+)\s*=\s*"([^"]*)"/g

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Decode the entity subset 3Shape emits (incl. `&#xA;` inside OrderComments). */
export function decodeEntities(value) {
  if (!value || value.indexOf('&') === -1) return value
  return value.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

function parseAttrs(raw) {
  const attrs = {}
  if (!raw) return attrs
  ATTR.lastIndex = 0
  let m
  while ((m = ATTR.exec(raw))) attrs[m[1]] = decodeEntities(m[2])
  return attrs
}

/**
 * @typedef {{ name: string, attrs: Record<string,string>, children: XmlNode[] }} XmlNode
 * @returns {XmlNode} synthetic root whose children are the document's top-level elements
 */
export function parseXml(source) {
  const root = { name: '#document', attrs: {}, children: [] }
  const stack = [root]
  TOKEN.lastIndex = 0
  let m
  while ((m = TOKEN.exec(source))) {
    const [, closeName, openName, rawAttrs, selfClosing] = m
    if (closeName) {
      // Tolerate stray/mismatched closers rather than throwing on a 40MB file.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === closeName) { stack.length = i; break }
      }
    } else if (openName) {
      const node = { name: openName, attrs: parseAttrs(rawAttrs), children: [] }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
    }
  }
  return root
}

/** Depth-first walk over every element node. */
export function* walk(node) {
  for (const child of node.children) {
    yield child
    yield* walk(child)
  }
}

/** First descendant matching `predicate`, or null. */
export function find(node, predicate) {
  for (const el of walk(node)) if (predicate(el)) return el
  return null
}

/** Direct children named `name`. */
export function childrenNamed(node, name) {
  return node.children.filter((c) => c.name === name)
}
