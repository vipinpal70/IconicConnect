import { describe, expect, it } from 'vitest'
import { renderNotificationEmail, safeEmailLink } from '@/src/lib/notifications/email-template'

const BASE = 'https://app.example.com'

describe('notification email template', () => {
  it('escapes HTML in the title and message (text people typed never becomes markup)', () => {
    const html = renderNotificationEmail(
      'New conversation SUP-000123',
      `Bright Lab: "<img src=x onerror=alert(1)> <a href='https://evil.test'>click</a>" & more`,
      '/support?ticket=1',
    )
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain("<a href='https://evil.test'>")
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&quot;')
    expect(html).toContain('&amp; more')
  })

  it('escapes the title in both <title> and the heading', () => {
    const html = renderNotificationEmail('<script>x</script>', 'm', null)
    expect(html).not.toContain('<script>')
    expect(html.match(/&lt;script&gt;x&lt;\/script&gt;/g)).toHaveLength(2)
  })

  it('keeps line breaks of plain-text messages readable', () => {
    expect(renderNotificationEmail('t', 'line 1\nline 2', null)).toContain('white-space: pre-line')
  })

  it('has no button without a safe link', () => {
    expect(renderNotificationEmail('t', 'm', null)).not.toContain('View Details')
    expect(renderNotificationEmail('t', 'm', 'javascript:alert(1)')).not.toContain('View Details')
  })
})

describe('safe email links', () => {
  it('turns app paths into absolute links (relative links go nowhere in an inbox)', () => {
    expect(safeEmailLink('/cases/42', BASE)).toBe('https://app.example.com/cases/42')
    expect(safeEmailLink('/support?ticket=1&x=2', `${BASE}/`)).toBe('https://app.example.com/support?ticket=1&x=2')
  })

  it('keeps http(s) URLs', () => {
    expect(safeEmailLink('https://example.com/a', BASE)).toBe('https://example.com/a')
  })

  it('drops dangerous or ambiguous links', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x</b>', '//evil.test/x', '/\\evil.test', 'vbscript:x', 'cases/42', '']) {
      expect(safeEmailLink(bad, BASE), bad).toBeNull()
    }
    expect(safeEmailLink(undefined, BASE)).toBeNull()
  })

  it('drops app paths when no app URL is configured', () => {
    expect(safeEmailLink('/cases/42', '')).toBeNull()
  })

  it('escapes the link inside the href attribute', () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = BASE
    try {
      const html = renderNotificationEmail('t', 'm', '/x?a="><script>')
      expect(html).toContain('href="https://app.example.com/x?a=&quot;&gt;&lt;script&gt;"')
      expect(html).not.toContain('"><script>')
      expect(html).toContain('View Details')
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = previous
    }
  })
})
