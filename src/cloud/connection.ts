export const CLOUD_WAIT_MS = 12_000

export function isConnectionError(error: unknown): boolean {
  if (!navigator.onLine) return true
  if (!error || typeof error !== 'object') return false
  const detail = error as { name?: string; message?: string; status?: number }
  return detail.name === 'AbortError' || detail.name === 'TimeoutError' ||
    detail.status === 0 || /network|failed to fetch|fetch failed|load failed|timed? out|connection|offline/i.test(detail.message ?? '')
}

export async function bounded<T>(operation: PromiseLike<T>, controller?: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller?.abort()
          reject(new DOMException('The connection timed out. Your downloaded trip has not changed.', 'TimeoutError'))
        }, CLOUD_WAIT_MS)
      }),
    ])
  } finally { clearTimeout(timer) }
}
