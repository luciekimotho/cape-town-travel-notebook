export interface CloudConfig {
  url: string
  publishableKey: string
}

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const cloudFeatureEnabled = import.meta.env.VITE_ENABLE_SUPABASE === 'true'

export function getCloudConfig(): CloudConfig | undefined {
  if (!cloudFeatureEnabled || !url || !publishableKey) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return undefined
  } catch {
    return undefined
  }
  return { url, publishableKey }
}

export function cloudSetupIssue(): string | undefined {
  if (!cloudFeatureEnabled) return 'Shared access is not enabled in this build.'
  if (!url || !publishableKey) return 'Add the Supabase project URL and publishable key to the build environment.'
  return getCloudConfig() ? undefined : 'The Supabase project URL is invalid.'
}
