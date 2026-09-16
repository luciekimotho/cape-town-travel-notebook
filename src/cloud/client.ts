import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getCloudConfig } from './config'

let client: SupabaseClient | undefined

export function getCloudClient(): SupabaseClient {
  const config = getCloudConfig()
  if (!config) throw new Error('Shared access is not configured.')
  client ??= createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'cape-town-notebook-auth',
    },
  })
  return client
}

export async function clearCloudSession() {
  if (!client) return
  const { error } = await client.auth.signOut({ scope: 'local' })
  if (error) throw error
  client = undefined
  if ('caches' in window) {
    for (const key of await caches.keys()) {
      if (key.startsWith('cape-town-notebook-user-')) await caches.delete(key)
    }
  }
}
