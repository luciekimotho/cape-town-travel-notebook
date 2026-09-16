import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData } from '../types'
import { CloudNotebookRepository, createFreshTrip, listCloudTrips, loadCloudNotebook } from './repository'

describe('cloud repository', () => {
  it('creates the fresh Cape Town notebook through the server bootstrap', async () => {
    let rpcName = ''
    const client = { rpc:async(name:string)=>{rpcName=name;return {data:'trip-1',error:null}} } as unknown as SupabaseClient
    await expect(createFreshTrip(client)).resolves.toBe('trip-1')
    expect(rpcName).toBe('create_capetown_2026_trip_v2')
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
      photos:[{ id:'photo-1', stampId:'stamp-1', caption:'View', mimeType:'image/jpeg', width:10, height:10, size:4, storagePath:'trip-1/photo-1-version.jpg', createdAt:'2026-01-01', updatedAt:'2026-01-01' }],
      rateSets:[], metadata:[],
    }
    const blob = new Blob(['test'], { type:'image/jpeg' })
    const client = {
      rpc:async()=>({ data:notebook, error:null }),
      storage:{ from:()=>({ download:async(path:string)=>({data:path === 'trip-1/photo-1-version.jpg' ? blob : undefined,error:null}) }) },
    } as unknown as SupabaseClient
    const loaded = await loadCloudNotebook('trip-1',client)
    expect(loaded.photos[0]).toMatchObject({ id:'photo-1', storagePath:'trip-1/photo-1-version.jpg', blob })
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

  it('sends a trip-scoped mutation, requires acknowledgement, and reloads', async () => {
    const calls: Array<{ name:string; args?:Record<string, unknown> }> = []
    const notebook = {
      trip:{}, checklist:[], days:[], items:[], places:[], activityTemplates:[], expenses:[], stamps:[],
      photos:[], rateSets:[], metadata:[],
    }
    const client = {
      rpc:async(name:string,args?:Record<string, unknown>)=>{
        calls.push({name,args})
        return name === 'mutate_notebook_v1'
          ? {data:{ok:true,operation:'checklist.toggle',id:'todo-1'},error:null}
          : {data:notebook,error:null}
      },
    } as unknown as SupabaseClient
    const result = await new CloudNotebookRepository('trip-1',client).toggleChecklist('todo-1')
    expect(result.acknowledgement).toMatchObject({ok:true,operation:'checklist.toggle'})
    expect(calls).toEqual([
      {name:'mutate_notebook_v1',args:{p_trip_id:'trip-1',p_operation:'checklist.toggle',p_payload:{id:'todo-1'}}},
      {name:'load_notebook_v4',args:{p_trip_id:'trip-1'}},
    ])
  })

  it('does not reload an unacknowledged write', async () => {
    let calls = 0
    const client = { rpc:async()=>{ calls++; return {data:null,error:null} } } as unknown as SupabaseClient
    await expect(new CloudNotebookRepository('trip-1',client).deleteExpense('cost-1'))
      .rejects.toThrow('did not acknowledge')
    expect(calls).toBe(1)
  })

  it('reports a committed write when the follow-up reload fails', async () => {
    let calls = 0
    const client = {
      rpc:async(name:string)=>{
        calls++
        return name === 'mutate_notebook_v1'
          ? {data:{ok:true,operation:'checklist.delete',id:'todo-1'},error:null}
          : {data:null,error:new Error('network dropped')}
      },
    } as unknown as SupabaseClient
    await expect(new CloudNotebookRepository('trip-1',client).deleteChecklist('todo-1')).resolves.toMatchObject({
      acknowledgement:{ok:true,operation:'checklist.delete'},
      cleanupWarning:expect.stringContaining('change was saved'),
    })
    expect(calls).toBe(2)
  })

  it('uploads photo bytes before metadata and removes an orphan if metadata fails', async () => {
    const order:string[] = []
    let mutationArgs:Record<string, unknown> | undefined
    const bucket = {
      upload:async(path:string)=>{order.push(`upload:${path}`);return {data:{path},error:null}},
      remove:async(paths:string[])=>{order.push(`remove:${paths[0]}`);return {data:[],error:null}},
    }
    const client = {
      rpc:async(_name:string,args:Record<string, unknown>)=>{
        mutationArgs=args
        order.push('metadata')
        return {data:null,error:new Error('metadata rejected')}
      },
      storage:{from:()=>bucket},
    } as unknown as SupabaseClient
    await expect(new CloudNotebookRepository('11111111-1111-4111-8111-111111111111',client).addPhoto({
      id:'photo-1',stampId:'stamp-1',caption:'',mimeType:'image/jpeg',
      width:10,height:10,blob:new Blob(['photo']),
    })).rejects.toThrow('metadata rejected')
    expect(order[0]).toMatch(/^upload:11111111-1111-4111-8111-111111111111\/photo-1-[0-9a-f-]{36}\.jpg$/)
    expect(order).toEqual([order[0], 'metadata', `remove:${order[0].slice('upload:'.length)}`])
    const uploadedPath = order[0].slice('upload:'.length)
    expect(mutationArgs?.p_payload).toEqual({photo:{
      id:'photo-1',stampId:'stamp-1',caption:'',mimeType:'image/jpeg',
      width:10,height:10,size:5,
      objectPath:uploadedPath,
    }})
    expect(JSON.stringify(mutationArgs)).not.toContain('blob')
  })

  it('replaces photo metadata before removing the acknowledged old object', async () => {
    const order:string[] = []
    let mutationArgs:Record<string, unknown> | undefined
    const notebook = {
      trip:{}, checklist:[], days:[], items:[], places:[], activityTemplates:[], expenses:[], stamps:[],
      photos:[], rateSets:[], metadata:[],
    }
    const bucket = {
      upload:async(path:string)=>{order.push(`upload:${path}`);return {data:{path},error:null}},
      remove:async(paths:string[])=>{order.push(`remove:${paths[0]}`);return {data:[],error:null}},
    }
    const client = {
      rpc:async(name:string,args:Record<string, unknown>)=>{
        if (name === 'mutate_notebook_v1') {
          mutationArgs=args
          order.push('replace-metadata')
          return {data:{
            ok:true,operation:'photo.replace',id:'photo-1',
            objectPath:'trip-1/photo-old.jpg',
          },error:null}
        }
        order.push('reload')
        return {data:notebook,error:null}
      },
      storage:{from:()=>bucket},
    } as unknown as SupabaseClient
    await new CloudNotebookRepository('trip-1',client).replacePhoto(
      {id:'photo-1'},
      {
        id:'photo-1',stampId:'stamp-1',caption:'New',mimeType:'image/webp',
        width:20,height:10,blob:new Blob(['new-photo']),
      },
    )
    expect(order[0]).toMatch(/^upload:trip-1\/photo-1-[0-9a-f-]{36}\.webp$/)
    expect(order).toEqual([order[0], 'replace-metadata', 'reload', 'remove:trip-1/photo-old.jpg'])
    const replacementPath = order[0].slice('upload:'.length)
    expect(mutationArgs).toMatchObject({
      p_trip_id:'trip-1',
      p_operation:'photo.replace',
      p_payload:{
        oldId:'photo-1',
        photo:{id:'photo-1',stampId:'stamp-1',size:9,objectPath:replacementPath},
      },
    })
  })

  it('removes newly uploaded replacement bytes when the metadata swap fails', async () => {
    const order:string[] = []
    const bucket = {
      upload:async(path:string)=>{order.push(`upload:${path}`);return {data:{path},error:null}},
      remove:async(paths:string[])=>{order.push(`remove:${paths[0]}`);return {data:[],error:null}},
    }
    const client = {
      rpc:async()=>{order.push('replace-metadata');return {data:null,error:new Error('swap failed')}},
      storage:{from:()=>bucket},
    } as unknown as SupabaseClient
    await expect(new CloudNotebookRepository('trip-1',client).replacePhoto(
      {id:'photo-1'},
      {
        id:'photo-1',stampId:'stamp-1',caption:'',mimeType:'image/png',
        width:1,height:1,blob:new Blob(['new']),
      },
    )).rejects.toThrow('swap failed')
    expect(order[0]).toMatch(/^upload:trip-1\/photo-1-[0-9a-f-]{36}\.png$/)
    expect(order).toEqual([order[0], 'replace-metadata', `remove:${order[0].slice('upload:'.length)}`])
  })

  it('uses the server path when deleting a concurrently replaced photo', async () => {
    const removed:string[][] = []
    const notebook = {
      trip:{}, checklist:[], days:[], items:[], places:[], activityTemplates:[], expenses:[], stamps:[],
      photos:[], rateSets:[], metadata:[],
    }
    const client = {
      rpc:async(name:string)=>name === 'mutate_notebook_v1'
        ? {data:{ok:true,operation:'photo.delete',objectPath:'trip-1/current-version.jpg'},error:null}
        : {data:notebook,error:null},
      storage:{from:()=>({remove:async(paths:string[])=>{removed.push(paths);return {data:[],error:null}}})},
    } as unknown as SupabaseClient
    await new CloudNotebookRepository('trip-1',client).deletePhoto({
      id:'photo-1',mimeType:'image/jpeg',storagePath:'trip-1/stale-version.jpg',
    })
    expect(removed).toEqual([['trip-1/current-version.jpg']])
  })

  it('normalizes owner sharing through the acknowledged mutation boundary', async () => {
    const requests:Record<string, unknown>[] = []
    const client = {
      rpc:async(name:string,args:Record<string, unknown>)=>{
        requests.push(args)
        return name === 'mutate_notebook_v1'
          ? {data:{ok:true,operation:'collaboration.share'},error:null}
          : {data:{trip:{},photos:[]},error:null}
      },
    } as unknown as SupabaseClient
    await new CloudNotebookRepository('trip-1',client).shareWithEmail(' Friend@Example.com ')
    expect(requests[0]).toMatchObject({
      p_trip_id:'trip-1',
      p_operation:'collaboration.share',
      p_payload:{email:'friend@example.com'},
    })
  })

  it('uploads restore photos before one RPC and removes old objects after acknowledgement', async () => {
    const order:string[] = []
    let restorePayload:Record<string, unknown> | undefined
    const restoreData:AppData = {
      trip:{id:'current',destination:'Cape Town',travellers:2,startDate:'2026-09-21',endDate:'2026-09-21',timezone:'Africa/Johannesburg',notes:'',updatedAt:'2026-01-01'},
      checklist:[],days:[],items:[],places:[],activityTemplates:[],expenses:[],stamps:[],rateSets:[],metadata:[],
      photos:[{id:'photo-1',stampId:'stamp-1',caption:'View',mimeType:'image/jpeg',width:2,height:2,size:3,blob:new Blob(['abc']),createdAt:'2026-01-01',updatedAt:'2026-01-01'}],
    }
    const bucket = {
      upload:async(path:string)=>{order.push(`upload:${path}`);return {data:{path},error:null}},
      remove:async(paths:string[])=>{order.push(`remove:${paths.join(',')}`);return {data:[],error:null}},
    }
    const client = {
      rpc:async(name:string,args:Record<string, unknown>)=>{
        if (name === 'restore_notebook_v1') {
          order.push('restore-rpc')
          restorePayload=args.p_payload as Record<string, unknown>
          return {data:{ok:true,operation:'notebook.restore',objectPaths:['trip-1/old.jpg'],counts:{photos:1}},error:null}
        }
        order.push('reload')
        return {data:{...restoreData,photos:[]},error:null}
      },
      storage:{from:()=>bucket},
    } as unknown as SupabaseClient
    const result = await new CloudNotebookRepository('trip-1',client).restoreNotebook(restoreData)
    expect(order[0]).toMatch(/^upload:trip-1\/photo-1-[0-9a-f-]{36}\.jpg$/)
    expect(order).toEqual([order[0],'restore-rpc','remove:trip-1/old.jpg','reload'])
    expect(result.acknowledgement.counts).toEqual({photos:1})
    expect(restorePayload?.schemaVersion).toBe(4)
    const restoredPhotos = restorePayload?.photos as Record<string, unknown>[]
    expect(restoredPhotos[0]).toMatchObject({
      id:'photo-1',size:3,storagePath:order[0].slice('upload:'.length),
    })
    expect(JSON.stringify(restorePayload)).not.toContain('blob')
  })

  it('cleans uploaded restore objects after RPC failure and retries with fresh paths', async () => {
    const uploads:string[] = []
    const removals:string[][] = []
    let attempts = 0
    const restoreData:AppData = {
      trip:{id:'current',destination:'Cape Town',travellers:2,startDate:'2026-09-21',endDate:'2026-09-21',timezone:'UTC',notes:'',updatedAt:'2026-01-01'},
      checklist:[],days:[],items:[],places:[],activityTemplates:[],expenses:[],stamps:[],rateSets:[],metadata:[],
      photos:[{id:'photo-1',stampId:'stamp-1',caption:'',mimeType:'image/png',width:1,height:1,size:3,blob:new Blob(['abc']),createdAt:'2026-01-01',updatedAt:'2026-01-01'}],
    }
    const bucket = {
      upload:async(path:string)=>{uploads.push(path);return {data:{path},error:null}},
      remove:async(paths:string[])=>{removals.push(paths);return {data:[],error:null}},
    }
    const client = {
      rpc:async(name:string)=>{
        if (name === 'restore_notebook_v1') {
          attempts++
          return attempts === 1
            ? {data:null,error:new Error('validation failed')}
            : {data:{ok:true,operation:'notebook.restore',objectPaths:[]},error:null}
        }
        return {data:{...restoreData,photos:[]},error:null}
      },
      storage:{from:()=>bucket},
    } as unknown as SupabaseClient
    const repository = new CloudNotebookRepository('trip-1',client)
    await expect(repository.restoreNotebook(restoreData)).rejects.toThrow('validation failed')
    await expect(repository.restoreNotebook(restoreData)).resolves.toMatchObject({cleanupWarning:undefined})
    expect(uploads).toHaveLength(2)
    expect(uploads[0]).not.toBe(uploads[1])
    expect(removals).toEqual([[uploads[0]]])
  })

  it('cleans earlier restore uploads when a later upload fails before the RPC', async () => {
    const uploads:string[] = []
    const removals:string[][] = []
    let rpcCalled = false
    const photo = {stampId:'stamp-1',caption:'',mimeType:'image/jpeg' as const,width:1,height:1,size:1,blob:new Blob(['x']),createdAt:'2026-01-01',updatedAt:'2026-01-01'}
    const data:AppData = {
      trip:{id:'current',destination:'Cape Town',travellers:2,startDate:'2026-09-21',endDate:'2026-09-21',timezone:'UTC',notes:'',updatedAt:'2026-01-01'},
      checklist:[],days:[],items:[],places:[],activityTemplates:[],expenses:[],stamps:[],rateSets:[],metadata:[],
      photos:[{...photo,id:'photo-1'},{...photo,id:'photo-2'}],
    }
    const bucket = {
      upload:async(path:string)=>{
        uploads.push(path)
        return uploads.length === 2 ? {data:null,error:new Error('upload failed')} : {data:{path},error:null}
      },
      remove:async(paths:string[])=>{removals.push(paths);return {data:[],error:null}},
    }
    const client = {
      rpc:async()=>{rpcCalled=true;return {data:null,error:null}},
      storage:{from:()=>bucket},
    } as unknown as SupabaseClient
    await expect(new CloudNotebookRepository('trip-1',client).restoreNotebook(data)).rejects.toThrow('upload failed')
    expect(rpcCalled).toBe(false)
    expect(removals).toEqual([[uploads[0]]])
  })

  it('surfaces owner-only restore rejection without mutating locally', async () => {
    const client = {
      rpc:async()=>({data:null,error:new Error('Only a trip owner may restore a notebook')}),
      storage:{from:()=>({remove:async()=>({data:[],error:null})})},
    } as unknown as SupabaseClient
    const data = {
      trip:{id:'current',destination:'Cape Town',travellers:2,startDate:'2026-09-21',endDate:'2026-09-21',timezone:'UTC',notes:'',updatedAt:'2026-01-01'},
      checklist:[],days:[],items:[],places:[],activityTemplates:[],expenses:[],stamps:[],photos:[],rateSets:[],metadata:[],
    } as AppData
    await expect(new CloudNotebookRepository('trip-1',client).restoreNotebook(data))
      .rejects.toThrow('Only a trip owner')
  })

  it('returns a warning when post-commit old-object cleanup fails', async () => {
    const data = {
      trip:{id:'current',destination:'Cape Town',travellers:2,startDate:'2026-09-21',endDate:'2026-09-21',timezone:'UTC',notes:'',updatedAt:'2026-01-01'},
      checklist:[],days:[],items:[],places:[],activityTemplates:[],expenses:[],stamps:[],photos:[],rateSets:[],metadata:[],
    } as AppData
    const client = {
      rpc:async(name:string)=>name === 'restore_notebook_v1'
        ? {data:{ok:true,operation:'notebook.restore',objectPaths:['trip-1/orphan.jpg']},error:null}
        : {data,error:null},
      storage:{from:()=>({remove:async()=>({data:null,error:new Error('Storage unavailable')})})},
    } as unknown as SupabaseClient
    const result = await new CloudNotebookRepository('trip-1',client).restoreNotebook(data)
    expect(result.cleanupWarning).toContain('Restore committed')
  })
})
