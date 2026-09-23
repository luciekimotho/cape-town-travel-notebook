import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CloudNotebookRepository, loadCloudNotebook } from './repository'
import { CloudNotebookStore } from './notebookStore'
import type { AppData } from '../types'

const timestamp = '2026-09-17T00:00:00Z'
const notebook: AppData = {
  trip:{ id:'current', destination:'Cape Town', travellers:2, startDate:'2026-09-21', endDate:'2026-09-28', timezone:'Africa/Johannesburg', notes:'', updatedAt:timestamp },
  places:[{ id:'place', name:'Mountain', stampKind:'boat', wantToVisit:true, createdAt:timestamp, updatedAt:timestamp }],
  items:[{ id:'item', placeId:'place', dayId:'day', stampKind:'pin', visited:true, position:0, createdAt:timestamp, updatedAt:timestamp }],
  activityTemplates:[{ id:'template', name:'Walk', description:'', stampKind:'road', stops:[], seeded:false, createdAt:timestamp, updatedAt:timestamp }],
  stamps:[{ id:'stamp', placeName:'Mountain', stampKind:'auto', itineraryItemId:'item', detached:false, visitDate:'2026-09-21', createdAt:timestamp }],
  checklist:[], days:[{ id:'day', date:'2026-09-21', outOfRange:false }], expenses:[], photos:[], rateSets:[], metadata:[],
}
const cloudNotebook = { ...notebook, schemaVersion:4 as const }

describe('cloud stamp design protocol', () => {
  it('loads all optional choices through the design-aware RPC', async () => {
    const rpc = vi.fn(async () => ({ data:cloudNotebook, error:null }))
    expect(await loadCloudNotebook('trip', { rpc } as unknown as SupabaseClient)).toEqual(cloudNotebook)
    expect(rpc).toHaveBeenCalledWith('load_notebook_v6', { p_trip_id:'trip' })
  })

  it.each(['places', 'items', 'activityTemplates', 'stamps'] as const)('rejects invalid cloud %s choices', async key => {
    const client = { rpc:async () => ({ data:{ ...cloudNotebook, [key]:[{ ...notebook[key][0], stampKind:'bad' }] }, error:null }) } as unknown as SupabaseClient
    await expect(loadCloudNotebook('trip', client)).rejects.toThrow('stampKind')
  })

  it('sends choices on every supported store pathway, and never sends stale stamp snapshots', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    const calls: Array<{ operation:unknown; payload:unknown }> = []
    const client = {
      rpc:async (name:string, args?:Record<string, unknown>) => {
        if (name === 'load_notebook_v6') return { data:cloudNotebook, error:null }
        calls.push({ operation:args?.p_operation, payload:args?.p_payload })
        return { data:{ ok:true, operation:args?.p_operation }, error:null }
      },
    } as unknown as SupabaseClient
    const store = new CloudNotebookStore('trip', client)
    await store.createItineraryPlace(notebook.places[0], notebook.items[0])
    await store.addPlace(notebook.places[0])
    await store.updatePlace('place', { stampKind:'cliff', updatedAt:timestamp })
    await store.scheduleCandidatePlace('place', 'day', undefined, { stampKind:'boat' }, { stampKind:'pin' })
    await store.saveItineraryDetails('item', { stampKind:'auto' }, undefined)
    await store.updateTemplate('template', { name:'Walk', description:'', stampKind:'wine', updatedAt:timestamp })
    await store.materializeTemplate(notebook.activityTemplates[0], 'day', undefined, { stampKind:'house' })
    await store.createStamp({ ...notebook.stamps[0], stampKind:'wine' }, 'item')
    expect(calls).toEqual([
      { operation:'itinerary.create', payload:{ place:notebook.places[0], item:notebook.items[0] } },
      { operation:'place.create', payload:{ place:notebook.places[0] } },
      { operation:'place.update', payload:{ id:'place', patch:{ stampKind:'cliff', updatedAt:timestamp } } },
      { operation:'place.schedule', payload:{ placeId:'place', dayId:'day', placePatch:{ stampKind:'boat' }, itemPatch:{ stampKind:'pin' } } },
      { operation:'itinerary.update', payload:{ id:'item', patch:{ stampKind:'auto' } } },
      { operation:'template.update', payload:{ id:'template', patch:{ name:'Walk', description:'', stampKind:'wine', updatedAt:timestamp } } },
      { operation:'template.materialize', payload:{ templateId:'template', dayId:'day', details:{ stampKind:'house' } } },
      { operation:'stamp.create', payload:{ itemId:'item' } },
    ])
  })

  it('restores all choices without changing backup schema 4', async () => {
    let payload: unknown
    const client = {
      rpc:async (name:string, args?:Record<string, unknown>) => {
        if (name === 'load_notebook_v6') return { data:cloudNotebook, error:null }
        expect(name).toBe('restore_notebook_v3')
        payload = args?.p_payload
        return { data:{ ok:true, operation:'notebook.restore', objectPaths:[] }, error:null }
      },
      storage:{ from:() => ({}) },
    } as unknown as SupabaseClient
    await new CloudNotebookRepository('trip', client).restoreNotebook(notebook)
    expect(payload).toEqual({ ...notebook, schemaVersion:4 })
  })

  it('fails clearly for missing migrations on read, write and restore, without falling back', async () => {
    const rpc = vi.fn(async () => ({ data:null, error:{ code:'PGRST202', message:'Missing function' } }))
    const client = { rpc, storage:{ from:() => ({}) } } as unknown as SupabaseClient
    const repository = new CloudNotebookRepository('trip', client)
    await expect(repository.load()).rejects.toThrow('0006_itinerary_links.sql')
    await expect(repository.updatePlace('place', { stampKind:'pin' })).rejects.toThrow('0006_itinerary_links.sql')
    await expect(repository.restoreNotebook(notebook)).rejects.toThrow('0006_itinerary_links.sql')
    expect(rpc).toHaveBeenCalledTimes(3)
  })
})
