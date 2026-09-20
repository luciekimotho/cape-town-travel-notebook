import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signOut } from './auth'

const mocks = vi.hoisted(() => ({ clearAll: vi.fn(), clearCloudSession: vi.fn() }))
vi.mock('../offline/downloads', () => ({ offlineDownloads: { clearAll: mocks.clearAll } }))
vi.mock('./client', () => ({ clearCloudSession: mocks.clearCloudSession, getCloudClient: vi.fn() }))

beforeEach(() => { vi.resetAllMocks() })

describe('explicit logout', () => {
  it('waits for private snapshot and lease invalidation before signing out', async () => {
    let resolve!: () => void
    mocks.clearAll.mockReturnValue(new Promise<void>(done => { resolve = done }))
    const onDeviceCleared = vi.fn()
    const operation = signOut(onDeviceCleared)
    expect(mocks.clearCloudSession).not.toHaveBeenCalled()
    resolve()
    await operation
    expect(onDeviceCleared).toHaveBeenCalledOnce()
    expect(mocks.clearCloudSession).toHaveBeenCalledOnce()
    expect(mocks.clearAll.mock.invocationCallOrder[0]).toBeLessThan(mocks.clearCloudSession.mock.invocationCallOrder[0])
  })

  it('surfaces storage failures without falsely claiming signout', async () => {
    mocks.clearAll.mockRejectedValue(new Error('Cannot wipe this device'))
    await expect(signOut()).rejects.toThrow('Cannot wipe this device')
    expect(mocks.clearCloudSession).not.toHaveBeenCalled()
  })

  it('reports SDK failures after private data has already been removed', async () => {
    mocks.clearCloudSession.mockRejectedValue(new Error('Signout network unavailable'))
    const onDeviceCleared = vi.fn()
    await expect(signOut(onDeviceCleared)).rejects.toThrow('Signout network unavailable')
    expect(onDeviceCleared).toHaveBeenCalledOnce()
  })
})
