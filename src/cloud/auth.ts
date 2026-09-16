import type { Session } from '@supabase/supabase-js'
import { clearCloudSession, getCloudClient } from './client'

export async function requestSignIn(email: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('Email is required.')
  const { error } = await getCloudClient().auth.signInWithOtp({
    email: normalized,
    options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  })
  if (error) throw error
}

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await getCloudClient().auth.getSession()
  if (error) throw error
  return data.session
}

export async function signOut() {
  await clearCloudSession()
}

export async function claimSharedTrip() {
  const { data, error } = await getCloudClient().rpc('claim_trip_access')
  if (error) throw error
  return data
}
