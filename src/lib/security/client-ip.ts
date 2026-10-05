/**
 * Client IP behind Cloudflare → nginx → Next.
 *
 * Never trust the FIRST `X-Forwarded-For` entry: the client can send its own and nginx only
 * appends. Prefer the headers set by infrastructure the client cannot control
 * (`CF-Connecting-IP` from Cloudflare, `X-Real-IP` set by nginx from the real_ip module),
 * and fall back to the LAST forwarded hop (the one our proxy appended).
 */
export function getClientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
  }
  return 'unknown'
}
