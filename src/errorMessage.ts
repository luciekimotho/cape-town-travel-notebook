export function errorMessage(error: unknown, fallback: string): string {
  const detail = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : ''
  if (/network|failed to fetch|load failed|offline|connection|timed? out/i.test(detail)) {
    return 'Check your connection and try again.'
  }
  if (/quota|storage.*full|disk.*full|space/i.test(detail)) {
    return 'Free some storage on this device, then try again.'
  }
  if (/auth|session|token|jwt|sign.?in|credential/i.test(detail)) {
    if (/credential/i.test(detail)) return 'Check your email and password, then try again.'
    return 'Sign in again, then retry.'
  }
  if (/password.*weak|weak.*password/i.test(detail)) return 'Choose a stronger password, then try again.'
  if (/corrupt|invalid downloaded|unsupported version/i.test(detail)) {
    return 'Reconnect and refresh the offline copy in Settings.'
  }
  return fallback
}
