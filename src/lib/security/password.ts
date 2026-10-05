export const MIN_PASSWORD_LENGTH = 10

const COMMON = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou12',
  'welcome123', 'admin12345', 'letmein123', 'iconic1234', 'iconicconnect',
])

/** Returns an error message, or null when the password is acceptable. */
export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required'
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  if (password.length > 128) return 'Password must be at most 128 characters'
  if (COMMON.has(password.toLowerCase())) return 'That password is too common — choose a different one'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  if (classes < 3) return 'Use at least three of: lowercase, uppercase, numbers, symbols'
  return null
}
