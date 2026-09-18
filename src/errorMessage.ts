export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error &&
      typeof error.message === 'string' && error.message.trim()) {
    const code = 'code' in error && typeof error.code === 'string' && error.code.trim()
      ? ` (${error.code})` : ''
    return `${error.message}${code}`
  }
  return fallback
}
