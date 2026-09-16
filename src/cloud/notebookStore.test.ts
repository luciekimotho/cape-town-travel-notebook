import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CloudNotebookStore } from './notebookStore'

describe('cloud notebook store', () => {
  it('does not start a mutation while the browser is offline', async () => {
    const rpc = vi.fn()
    const client = { rpc } as unknown as SupabaseClient
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const store = new CloudNotebookStore('trip-1', client)

    await expect(store.deleteChecklist('todo-1')).rejects.toThrow('Nothing was saved')
    expect(rpc).not.toHaveBeenCalled()
  })
})
