import { describe, expect, it } from 'vitest'
import { cloudImportPayload, importNotebook, summarizeImport } from './import'
import type { AppData } from '../types'
import type { SupabaseClient } from '@supabase/supabase-js'

const emptyData = (): AppData => ({
  trip:{ id:'current', destination:'Cape Town', travellers:2, startDate:'2026-09-21', endDate:'2026-09-28', timezone:'Africa/Johannesburg', notes:'', updatedAt:'2026-01-01T00:00:00Z' },
  checklist:[], days:[], items:[], places:[], activityTemplates:[], expenses:[], stamps:[], photos:[], rateSets:[], metadata:[],
})

describe('cloud import preparation', () => {
  it('summarizes records and photo bytes before upload', () => {
    const data = emptyData()
    data.checklist.push({ id:'check-1', title:'Passport', category:'Documents', completed:false, createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    data.photos.push({ id:'photo-1', stampId:'stamp-1', caption:'View', mimeType:'image/jpeg', width:10, height:10, size:4, blob:new Blob(['test']), createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    expect(summarizeImport(data)).toMatchObject({ destination:'Cape Town', records:2, photos:1, photoBytes:4 })
  })

  it('preserves IDs, links, expense snapshots, and photo paths in the RPC payload', () => {
    const data = emptyData()
    data.items.push({ id:'item-1', dayId:'day-1', placeId:'place-1', parentId:'parent-1', visited:true, position:2, createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    data.expenses.push({ id:'expense-1', amount:30, currency:'USD', date:'2026-09-21', category:'Activity', rateSetId:'rate-1', itineraryItemId:'item-1', createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    data.photos.push({ id:'photo-1', stampId:'stamp-1', caption:'View', mimeType:'image/jpeg', width:10, height:10, size:4, blob:new Blob(['test']), createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    const payload = cloudImportPayload(data, 'trip-1', { 'photo-1':'trip-1/photo-1.jpg' })
    expect(payload.itinerary_items[0]).toMatchObject({ id:'item-1', parentId:'parent-1' })
    expect(payload.expenses[0]).toMatchObject({ itineraryItemId:'item-1', rateSetId:'rate-1', date:'2026-09-21' })
    expect(payload.photos[0]).toMatchObject({ id:'photo-1', stampId:'stamp-1', storagePath:'trip-1/photo-1.jpg' })
    expect(payload.photos[0]).not.toHaveProperty('blob')
  })

  it('uploads photo bytes before requesting an acknowledged atomic import', async () => {
    const data = emptyData()
    data.photos.push({ id:'photo-1', stampId:'stamp-1', caption:'View', mimeType:'image/webp', width:10, height:10, size:4, blob:new Blob(['test']), createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    const uploads: Array<{ path:string; body:Blob }> = []
    let rpcPayload: Record<string, unknown> | undefined
    let rpcCalls = 0
    const client = {
      auth:{ getUser:async()=>({ data:{ user:{ id:'user-1' } }, error:null }) },
      storage:{ from:()=>({ upload:async(path:string,body:Blob)=>{uploads.push({path,body});return {error:null}} }) },
      rpc:async(_name:string,args:Record<string, unknown>)=>{
        rpcCalls += 1
        if (rpcCalls === 1) return {data:'trip-1',error:null}
        rpcPayload=args
        return {data:'trip-1',error:null}
      },
    } as unknown as SupabaseClient
    expect(await importNotebook(data, 'batch-1', client)).toBe('trip-1')
    expect(uploads).toEqual([{ path:'trip-1/photo-1.webp', body:data.photos[0].blob }])
    expect(rpcPayload).toMatchObject({
      import_batch_id:'batch-1',
      notebook:{ trip_id:'trip-1', photos:[{ id:'photo-1', storagePath:'trip-1/photo-1.webp' }] },
    })
  })

  it('does not report success when the server rejects an import', async () => {
    let rpcCalls = 0
    const client = {
      auth:{ getUser:async()=>({ data:{ user:{ id:'user-1' } }, error:null }) },
      storage:{ from:()=>({ upload:async()=>({error:null}) }) },
      rpc:async()=>{
        rpcCalls += 1
        return rpcCalls === 1 ? {data:'trip-1',error:null} : {data:null,error:new Error('Import denied')}
      },
    } as unknown as SupabaseClient
    await expect(importNotebook(emptyData(), 'batch-1', client)).rejects.toThrow('Import denied')
  })

  it('rejects a retry when an existing photo has different bytes', async () => {
    const data = emptyData()
    data.photos.push({ id:'photo-1', stampId:'stamp-1', caption:'View', mimeType:'image/jpeg', width:10, height:10, size:4, blob:new Blob(['good']), createdAt:'2026-01-01', updatedAt:'2026-01-01' })
    const client = {
      auth:{ getUser:async()=>({ data:{ user:{ id:'user-1' } }, error:null }) },
      rpc:async()=>({data:'trip-1',error:null}),
      storage:{ from:()=>({
        upload:async()=>({error:new Error('The resource already exists')}),
        download:async()=>({data:new Blob(['evil']),error:null}),
      }) },
    } as unknown as SupabaseClient
    await expect(importNotebook(data, 'batch-1', client)).rejects.toThrow('does not match')
  })
})
