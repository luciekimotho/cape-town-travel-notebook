import type { SupabaseClient } from '@supabase/supabase-js'
import { getCloudClient } from './client'

export async function createInvitation(
  tripId: string,
  email: string,
  role: 'owner' | 'editor' = 'editor',
  expiresAt?: string,
  client: SupabaseClient = getCloudClient(),
) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) throw new Error('Invitee email is required.')
  const { data, error } = await client.rpc('create_trip_invitation', {
    p_trip_id:tripId,
    p_email:normalizedEmail,
    p_role:role,
    ...(expiresAt ? { p_expires_at:expiresAt } : {}),
  })
  if (error) throw error
  const invitation = Array.isArray(data) ? data[0] : data
  if (!invitation?.invitation_id || !invitation?.token) throw new Error('The server did not create an invitation.')
  return { id:String(invitation.invitation_id), token:String(invitation.token) }
}

export async function revokeInvitation(invitationId: string, client: SupabaseClient = getCloudClient()) {
  const { error } = await client.rpc('revoke_trip_invitation', { p_invitation_id:invitationId })
  if (error) throw error
}
