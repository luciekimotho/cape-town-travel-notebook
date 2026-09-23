import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CloudNotebookStore } from './notebookStore'
import { metadataFixture } from '../offline/test-fixtures'

describe('cloud notebook store', () => {
  it('rejects writes while reconnect verification is pending even when online', async () => {
    const rpc = vi.fn()
    const client = { rpc } as unknown as SupabaseClient
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    const store = new CloudNotebookStore('trip-1', client)
    store.readOnly = true

    await expect(store.deleteChecklist('todo-1')).rejects.toThrow('verify your account')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('freezes writes after transport failure without retrying a mutation', async () => {
    const rpc = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = { rpc } as unknown as SupabaseClient
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    const store = new CloudNotebookStore('trip-1', client)
    store.onUnavailable = vi.fn()

    await expect(store.deleteChecklist('todo-1')).rejects.toThrow('Failed to fetch')
    expect(store.readOnly).toBe(true)
    expect(store.onUnavailable).toHaveBeenCalledOnce()
    await expect(store.deleteChecklist('todo-1')).rejects.toThrow('Nothing was saved')
    expect(rpc).toHaveBeenCalledOnce()
  })

  it('does not start a mutation while the browser is offline', async () => {
    const rpc = vi.fn()
    const client = { rpc } as unknown as SupabaseClient
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const store = new CloudNotebookStore('trip-1', client)

    await expect(store.deleteChecklist('todo-1')).rejects.toThrow('Nothing was saved')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('freezes writes on the existing SQL membership-denied response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: {
      code: 'P0001', message: 'Trip membership with edit access is required',
    } })
    const client = { rpc } as unknown as SupabaseClient
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    const store = new CloudNotebookStore('trip-1', client)
    store.onUnavailable = vi.fn()
    await expect(store.deleteChecklist('todo-1')).rejects.toMatchObject({ code: 'P0001' })
    expect(store.readOnly).toBe(true)
    expect(store.onUnavailable).toHaveBeenCalledOnce()
  })

  it('never promotes a partial photo snapshot after a later acknowledged save cannot refresh it', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    const notebook = metadataFixture()
    const client = {
      rpc:async (name:string, args?:Record<string, unknown>) => name === 'mutate_notebook_v3'
        ? { data:{ ok:true, operation:args?.p_operation, id:'check-a' }, error:null }
        : { data:notebook, error:null },
      storage:{ from:()=>({ download:async()=>({ data:null, error:new TypeError('Failed to fetch photo') }) }) },
    } as unknown as SupabaseClient
    const store = new CloudNotebookStore('trip-a', client)
    store.onSnapshot = vi.fn()
    await expect(store.loadProgressive(client, vi.fn())).rejects.toThrow('Failed to fetch photo')
    await expect(store.setChecklistCompleted('check-a', false)).resolves.toMatchObject({
      warning:expect.stringContaining('saved'),
    })
    expect(store.onSnapshot).not.toHaveBeenCalled()
  })
})
