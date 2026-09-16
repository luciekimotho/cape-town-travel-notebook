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

export async function acceptInvitation(token: string) {
  const normalized = token.trim()
  if (!normalized) throw new Error('Invitation token is required.')
  const { data, error } = await getCloudClient().rpc('accept_trip_invitation', { p_token: normalized })
  if (error) throw error
  return data
}
