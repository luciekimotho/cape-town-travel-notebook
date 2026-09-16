import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revokeTripAccess, shareTripWithEmail } from './sharing'

describe('two-person trip sharing', () => {
  it('authorizes the exact normalized email through the owner-only RPC', async () => {
    let request: Record<string, unknown> | undefined
    const client = { rpc:async(_name:string,args:Record<string, unknown>)=>{request=args;return {data:null,error:null}} } as unknown as SupabaseClient
    await shareTripWithEmail('trip-1',' Friend@Example.com ',client)
    expect(request).toEqual({p_trip_id:'trip-1',p_email:'friend@example.com'})
  })

  it('surfaces authorization failures when revoking access', async () => {
    const client = { rpc:async()=>({data:null,error:new Error('Owner access required')}) } as unknown as SupabaseClient
    await expect(revokeTripAccess('trip-1',client)).rejects.toThrow('Owner access required')
  })
})
