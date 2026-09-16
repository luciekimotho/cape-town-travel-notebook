import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFreshTrip, listCloudTrips, loadCloudNotebook } from './repository'

describe('cloud repository', () => {
  it('creates the fresh Cape Town notebook through the server bootstrap', async () => {
    const client = { rpc:async()=>({data:'trip-1',error:null}) } as unknown as SupabaseClient
    await expect(createFreshTrip(client)).resolves.toBe('trip-1')
  })

  it('loads only the trip summaries acknowledged by the membership RPC', async () => {
    const client = {
      rpc:async()=>({ data:[{ id:'trip-1', destination:'Cape Town', role:'owner', updated_at:'2026-01-01' }], error:null }),
    } as unknown as SupabaseClient
    await expect(listCloudTrips(client)).resolves.toEqual([{ id:'trip-1', destination:'Cape Town', role:'owner', updatedAt:'2026-01-01' }])
  })

  it('downloads private photo bytes and validates their recorded size', async () => {
    const notebook = {
      schemaVersion:4,
      trip:{ id:'current', destination:'Cape Town', travellers:2, startDate:'2026-09-21', endDate:'2026-09-28', timezone:'Africa/Johannesburg', notes:'', updatedAt:'2026-01-01' },
      checklist:[], days:[], items:[], places:[], activityTemplates:[], expenses:[], stamps:[],
      photos:[{ id:'photo-1', stampId:'stamp-1', caption:'View', mimeType:'image/jpeg', width:10, height:10, size:4, createdAt:'2026-01-01', updatedAt:'2026-01-01' }],
      rateSets:[], metadata:[],
    }
    const blob = new Blob(['test'], { type:'image/jpeg' })
    const client = {
      rpc:async()=>({ data:notebook, error:null }),
      storage:{ from:()=>({ download:async(path:string)=>({data:path === 'trip-1/photo-1.jpg' ? blob : undefined,error:null}) }) },
    } as unknown as SupabaseClient
    const loaded = await loadCloudNotebook('trip-1',client)
    expect(loaded.photos[0]).toMatchObject({ id:'photo-1', blob })
  })

  it('rejects corrupt private photo bytes', async () => {
    const notebook = {
      trip:{}, checklist:[], days:[], items:[], places:[], activityTemplates:[], expenses:[], stamps:[],
      photos:[{ id:'photo-1', stampId:'stamp-1', caption:'', mimeType:'image/png', width:1, height:1, size:20, createdAt:'2026-01-01', updatedAt:'2026-01-01' }],
      rateSets:[], metadata:[],
    }
    const client = {
      rpc:async()=>({ data:notebook,error:null }),
      storage:{ from:()=>({ download:async()=>({data:new Blob(['bad']),error:null}) }) },
    } as unknown as SupabaseClient
    await expect(loadCloudNotebook('trip-1',client)).rejects.toThrow('wrong size')
  })
})
