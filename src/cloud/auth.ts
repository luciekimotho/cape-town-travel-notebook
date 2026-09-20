import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { clearCloudSession, getCloudClient } from './client'
import { getCloudConfig } from './config'
import { offlineDownloads } from '../offline/downloads'
import { bounded } from './connection'

export function consumeAuthCallbackError(): string {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const description = parameters.get('error_description')
  if (!description) return ''
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  return description.replace(/\+/g, ' ')
}

export async function requestSignIn(email: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('Email is required.')
  const { error } = await getCloudClient().auth.signInWithOtp({
    email: normalized,
    options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  })
  if (error) throw error
}

export async function verifySignInCode(email: string, code: string): Promise<Session> {
  const token = code.replace(/\s/g, '')
  if (!/^\d{6,10}$/.test(token)) throw new Error('Enter the 6–10 digit code from your email.')
  const { data, error } = await getCloudClient().auth.verifyOtp({
    email: email.trim().toLowerCase(), token, type: 'email',
  })
  if (error) throw error
  if (!data.session) throw new Error('Sign-in was not completed. Request a fresh email and try again.')
  return data.session
}

export async function verifySignInLink(link: string): Promise<Session> {
  const config = getCloudConfig()
  if (!config) throw new Error('Shared access is not configured.')
  let url: URL
  try { url = new URL(link.trim()) } catch {
    throw new Error('Copy the unopened sign-in link from your email and paste it here.')
  }
  const type = url.searchParams.get('type')
  const token = url.searchParams.get('token')
  if (url.origin !== new URL(config.url).origin || url.pathname !== '/auth/v1/verify' ||
      url.username || url.password || url.hash ||
      !token || !/^[a-zA-Z0-9_-]{20,512}$/.test(token) ||
      (type !== 'magiclink' && type !== 'signup' && type !== 'email')) {
    throw new Error('Use the original, unopened sign-in link from this notebook’s email. Browser address-bar links and already-used links cannot sign you in here.')
  }
  // Verify through this app's client; never navigate to or fetch the email URL.
  const { data, error } = await getCloudClient().auth.verifyOtp({ token_hash: token, type })
  if (error) throw error
  if (!data.session) throw new Error('Sign-in was not completed. Request a fresh email and try again.')
  return data.session
}

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await getCloudClient().auth.getSession()
  if (error) throw error
  return data.session
}

export async function signOut(onDeviceCleared?: () => void) {
  // Revoke download leases before the SDK can emit SIGNED_OUT.
  await offlineDownloads.clearAll()
  onDeviceCleared?.()
  await bounded(clearCloudSession())
}

export async function claimSharedTrip(client: SupabaseClient = getCloudClient()) {
  const { data, error } = await client.rpc('claim_trip_access')
  if (error) throw error
  return data
}
