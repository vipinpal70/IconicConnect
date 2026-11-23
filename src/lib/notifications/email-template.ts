import { escapeHtml } from '@/src/lib/security/html'

/**
 * The standard notification email. Titles and messages often contain text people typed (a case
 * number, a support subject, a lab name), so everything is escaped: no HTML from users reaches an inbox.
 */

/**
 * Only links into the app or to an http(s) URL get a button. Relative app paths ("/cases/123") become
 * absolute, because a relative link in an email goes nowhere. Anything else ("javascript:", "//evil",
 * "data:") is dropped.
 */
export function safeEmailLink(link: string | null | undefined, baseUrl = process.env.NEXT_PUBLIC_APP_URL): string | null {
  const value = link?.trim()
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
    const base = (baseUrl || '').replace(/\/+$/, '')
    return base ? `${base}${value}` : null
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function renderNotificationEmail(title: string, message: string, link?: string | null): string {
  const href = safeEmailLink(link)
  const safeTitle = escapeHtml(title)
  const actionButton = href
    ? `<div style="margin-top: 24px;">
           <a href="${escapeHtml(href)}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">View Details</a>
         </div>`
    : ''

  return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${safeTitle}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; padding: 40px; margin: 0;">
        <div style="max-width: 600px; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); margin: 0 auto; border: 1px solid #e4e4e7;">
          <div style="background-color: #0f172a; padding: 24px; text-align: center; border-bottom: 2px solid #059669;">
            <span style="font-size: 20px; font-weight: bold; color: white; letter-spacing: 0.5px;">IconicConnect</span>
          </div>
          <div style="padding: 32px; color: #1f2937;">
            <h2 style="font-size: 18px; font-weight: 600; margin-top: 0; color: #0f172a;">${safeTitle}</h2>
            <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px; white-space: pre-line;">${escapeHtml(message)}</p>
            ${actionButton}
          </div>
          <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">This is an automated email from IconicConnect.</p>
            <p style="margin: 4px 0 0 0;">You can customize your notification preferences inside your account profile dashboard.</p>
          </div>
        </div>
      </body>
      </html>
    `
}
