import type { SupabaseClient } from '@supabase/supabase-js'
import { getCloudClient } from './client'

export async function shareTripWithEmail(tripId: string, email: string, client: SupabaseClient = getCloudClient()) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) throw new Error('The second traveller’s email is required.')
  const { error } = await client.rpc('share_trip_with_email', {
    p_trip_id:tripId,
    p_email:normalizedEmail,
  })
  if (error) throw error
}

export async function revokeTripAccess(tripId: string, client: SupabaseClient = getCloudClient()) {
  const { error } = await client.rpc('revoke_trip_email_access', { p_trip_id:tripId })
  if (error) throw error
}
