import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createInvitation, revokeInvitation } from './invitations'

describe('cloud invitations', () => {
  it('requests an email-bound editor invitation and returns its one-time token', async () => {
    let request: Record<string, unknown> | undefined
    const client = { rpc:async(_name:string,args:Record<string, unknown>)=>{
      request=args
      return {data:[{invitation_id:'invite-1',token:'one-time-token'}],error:null}
    } } as unknown as SupabaseClient
    await expect(createInvitation('trip-1',' Friend@Example.com ','editor',undefined,client)).resolves.toEqual({id:'invite-1',token:'one-time-token'})
    expect(request).toEqual({p_trip_id:'trip-1',p_email:'friend@example.com',p_role:'editor'})
  })

  it('surfaces server authorization failures for revocation', async () => {
    const client = { rpc:async()=>({data:null,error:new Error('Owner access required')}) } as unknown as SupabaseClient
    await expect(revokeInvitation('invite-1',client)).rejects.toThrow('Owner access required')
  })
})
