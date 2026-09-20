import { Blob as NativeBlob } from 'node:buffer'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOAD_SCHEMA_VERSION, isAuthorizationError, isMembershipRevokedError, OfflineDownloads } from './downloads'
import { deferred, metadataFixture, mockClient, type Response } from './test-fixtures'
import { canonicalMetadata, validateCloudNotebook, validateDownloadedNotebook } from './validation'

let name: string
let downloads: OfflineDownloads
const connections: OfflineDownloads[] = []

beforeEach(() => {
  // fake-indexeddb uses Node's structuredClone, so use its cloneable Blob implementation.
  vi.stubGlobal('Blob', NativeBlob)
  name = `offline-test-${crypto.randomUUID()}`
  downloads = new OfflineDownloads({ databaseName: name })
  connections.push(downloads)
})

afterEach(async () => {
  vi.restoreAllMocks()
  connections.splice(0).forEach(connection => connection.close())
  await Dexie.delete(name)
  vi.unstubAllGlobals()
})

async function savedCopy() {
  await downloads.rememberAccount('user-a', 'trip-a')
  return downloads.download('user-a', 'trip-a', mockClient().client)
}

async function inspectDatabase<T>(run: (db: Dexie) => Promise<T>) {
  const db = new Dexie(name)
  db.version(1).stores({ snapshots: '[userId+tripId], userId', control: 'key', leases: '[userId+tripId], userId' })
  try { return await run(db) } finally { db.close() }
}

describe('private complete downloaded trips', () => {
  it('roundtrips every field, exact optional stamp choices, relationships, rates and real Blob bytes', async () => {
    await downloads.rememberAccount('user-a', 'trip-a')
    const { client, calls, raw } = mockClient()
    const progress: string[] = []
    const result = await downloads.download('user-a', 'trip-a', client, message => progress.push(message))
    expect(result).toMatchObject({ schemaVersion: DOWNLOAD_SCHEMA_VERSION, userId: 'user-a', tripId: 'trip-a' })
    expect(Date.parse(result.savedAt)).toBeGreaterThan(0)
    const copy = await downloads.getActive()
    expect(copy).toEqual(result)
    expect(copy!.notebook).toEqual({ ...raw, photos: [{ ...raw.photos[0], blob: expect.any(Blob) }] })
    expect(await copy!.notebook.photos[0].blob.text()).toBe('test')
    expect(copy!.notebook.expenses[0].rateSetId).toBe('rate-old')
    expect(copy!.notebook.rateSets[0].kesPerZar).toBe(7.25)
    expect(calls.auth).toBe(2)
    expect(calls.membership).toBe(2)
    expect(calls.load).toBe(2)
    expect(calls.photos).toEqual(['trip-a/photo-a-version.jpg'])
    expect(calls.signals.every(signal => signal.aborted)).toBe(true)
    expect(progress.at(-1)).toContain('Saving')
    result.notebook.trip.notes = 'Mutated'
    copy!.notebook.activityTemplates[0].stops[0].notes.push('Mutated')
    expect((await downloads.get('user-a', 'trip-a'))!.notebook.trip.notes).toBe(raw.trip.notes)
    expect((await downloads.getActive())!.notebook.activityTemplates[0].stops[0].notes).toEqual(raw.activityTemplates[0].stops[0].notes)
  })

  it('preserves absent optional properties rather than defaulting stamp choices', async () => {
    const raw = metadataFixture()
    delete raw.places[0].stampKind
    delete raw.items[0].stampKind
    delete raw.activityTemplates[0].stampKind
    delete raw.stamps[0].stampKind
    await downloads.rememberAccount('user-a', 'trip-a')
    const saved = await downloads.download('user-a', 'trip-a', mockClient({ notebook: raw }).client)
    expect(saved.notebook.places[0]).not.toHaveProperty('stampKind')
    expect(saved.notebook.items[0]).not.toHaveProperty('stampKind')
    expect(saved.notebook.activityTemplates[0]).not.toHaveProperty('stampKind')
    expect(saved.notebook.stamps[0]).not.toHaveProperty('stampKind')
  })

  it('reads remembered copies after session expiry without any credentials or network access', async () => {
    const expected = await savedCopy()
    downloads.close()
    const reopened = new OfflineDownloads({ databaseName: name })
    connections.push(reopened)
    expect(await reopened.getActive()).toEqual(expected)
    const state = await inspectDatabase(db => db.table('control').get('state'))
    expect(state).toEqual({ key: 'state', generation: expect.any(String), identity: { userId: 'user-a', tripId: 'trip-a' } })
    expect(await reopened.get('user-b', 'trip-a')).toBeUndefined()
  })

  it('returns undefined for no remembered identity or no completed copy', async () => {
    expect(await downloads.getActive()).toBeUndefined()
    await downloads.rememberAccount('user-a', 'trip-a')
    expect(await downloads.getActive()).toBeUndefined()
  })

  it('purges a different remembered identity even when neither account has a downloaded copy', async () => {
    await downloads.rememberAccount('user-a', 'trip-a')
    expect(await downloads.getActive()).toBeUndefined()
    await downloads.invalidateOtherUsers('user-b')
    expect(await downloads.getActive()).toBeUndefined()
    expect(await inspectDatabase(db => db.table('control').get('state'))).not.toHaveProperty('identity')
    const { client, calls } = mockClient()
    await expect(downloads.download('user-a', 'trip-a', client)).rejects.toThrow('cancelled')
    expect(calls.auth).toBe(0)
  })

  it('keeps the same verified account and completed copy without generation churn', async () => {
    const old = await savedCopy()
    const state = await inspectDatabase(db => db.table('control').get('state'))
    await downloads.invalidateOtherUsers('user-a')
    expect(await downloads.getActive()).toEqual(old)
    expect(await inspectDatabase(db => db.table('control').get('state'))).toEqual(state)
  })

  it('purges another account before the new account has verified any trip membership', async () => {
    await savedCopy()
    await downloads.invalidateOtherUsers('user-b')
    expect(await downloads.getActive()).toBeUndefined()
    expect(await downloads.get('user-a', 'trip-a')).toBeUndefined()
    expect(await inspectDatabase(db => db.table('snapshots').count())).toBe(0)
    expect(await inspectDatabase(db => db.table('leases').count())).toBe(0)
  })

  it.each([
    ['missing object', { data: null, error: new Error('Object not found') }],
    ['wrong size', { data: () => new Blob(['broken'], { type: 'image/jpeg' }), error: null }],
    ['wrong MIME', { data: () => new Blob(['test'], { type: 'image/png' }), error: null }],
    ['interrupted fetch', { data: null, error: new TypeError('Failed to fetch') }],
  ])('keeps the previous complete copy after %s', async (_label, response) => {
    const old = await savedCopy()
    const { client } = mockClient({
      photo: async () => ({ ...response, data: typeof response.data === 'function' ? response.data() : response.data }),
    })
    await expect(downloads.download('user-a', 'trip-a', client)).rejects.toBeDefined()
    expect(await downloads.getActive()).toEqual(old)
  })

  it('keeps the previous complete copy after transaction quota failure', async () => {
    const old = await savedCopy()
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'snapshots') throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      return original.apply(this, args)
    })
    await expect(downloads.download('user-a', 'trip-a', mockClient().client)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(await downloads.getActive()).toEqual(old)
  })

  it('bounds hanging requests, aborts cancellable work, and never promotes late responses', async () => {
    const old = await savedCopy()
    const timed = new OfflineDownloads({ databaseName: name, requestTimeoutMs: 25 })
    connections.push(timed)
    const late = deferred<Response>()
    let signal: AbortSignal | undefined
    const { client } = mockClient({ photo: async (_path, parameters) => {
      signal = parameters?.signal
      return late.promise
    } })
    await expect(timed.download('user-a', 'trip-a', client)).rejects.toThrow('timed out')
    expect(signal?.aborted).toBe(true)
    late.resolve({ data: new Blob(['test'], { type: 'image/jpeg' }), error: null })
    expect(await downloads.getActive()).toEqual(old)
  })

  it('bounds a hung auth request and does not use remembered identity as authentication', async () => {
    await savedCopy()
    const timed = new OfflineDownloads({ databaseName: name, requestTimeoutMs: 25 })
    connections.push(timed)
    const { client, calls } = mockClient({ auth: () => new Promise(() => {}) })
    await expect(timed.download('user-a', 'trip-a', client)).rejects.toThrow('timed out')
    expect(calls.load).toBe(0)
  })

  it.each(['initial auth', 'final auth', 'initial membership', 'final membership', 'different user'])('rejects %s failure without replacing a copy', async label => {
    const old = await savedCopy()
    let authCalls = 0
    let membershipCalls = 0
    const { client } = mockClient({
      auth: async () => {
        authCalls++
        const fail = label === 'initial auth' || label === 'final auth' && authCalls > 1
        return { data: { user: fail ? null : { id: label === 'different user' ? 'user-b' : 'user-a' } },
          error: fail ? { status: 401, message: 'JWT expired' } : null }
      },
      membership: async () => {
        membershipCalls++
        const fail = label === 'initial membership' || label === 'final membership' && membershipCalls > 1
        return { data: fail ? [] : [{ id: 'trip-a', role: 'editor' }], error: null }
      },
    })
    const error = await downloads.download('user-a', 'trip-a', client).catch(error => error)
    expect(isAuthorizationError(error)).toBe(true)
    expect(await downloads.getActive()).toEqual(old)
  })

  it('retries a changed notebook from scratch and only publishes the consistent copy', async () => {
    await downloads.rememberAccount('user-a', 'trip-a')
    const raw = metadataFixture()
    const newer = structuredClone(raw)
    newer.checklist[0].note = 'Changed during download'
    let loads = 0
    const { client, calls } = mockClient({ load: async () => ({ data: structuredClone(++loads === 1 ? raw : newer), error: null }) })
    const saved = await downloads.download('user-a', 'trip-a', client)
    expect(saved.notebook.checklist[0].note).toBe('Changed during download')
    expect(calls.photos).toHaveLength(2)
    expect(calls.load).toBe(4)
    expect(calls.auth).toBe(4)
  })

  it('compares every raw field, stops after two retries, and retains the old copy', async () => {
    const old = await savedCopy()
    let loads = 0
    const { client, calls } = mockClient({ load: async () => {
      const raw = metadataFixture()
      return { data: { ...raw, serverRevision: ++loads }, error: null }
    } })
    await expect(downloads.download('user-a', 'trip-a', client)).rejects.toThrow('kept changing')
    expect(calls.load).toBe(6)
    expect(calls.photos).toHaveLength(3)
    expect(await downloads.getActive()).toEqual(old)
  })

  it('ignores metadata object key ordering, but not field or array differences', () => {
    expect(canonicalMetadata({ b: 2, a: { y: 1, x: [1, 2] } })).toBe(canonicalMetadata({ a: { x: [1, 2], y: 1 }, b: 2 }))
    expect(canonicalMetadata([1, 2])).not.toBe(canonicalMetadata([2, 1]))
  })

  it.each(['logout', 'switch', 'remove', 'invalidate', 'other user', 'switch back', 'remove and redownload'])('prevents cross-instance %s races from repopulating copies', async action => {
    await savedCopy()
    const other = new OfflineDownloads({ databaseName: name })
    connections.push(other)
    const entered = deferred<void>()
    const photo = deferred<Response>()
    const { client } = mockClient({ photo: async () => { entered.resolve(); return photo.promise } })
    const pending = downloads.download('user-a', 'trip-a', client)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await entered.promise
    let replacement
    if (action === 'logout') await other.clearAll()
    if (action === 'switch' || action === 'switch back') {
      await other.rememberAccount('user-b', 'trip-b')
      if (action === 'switch back') await other.rememberAccount('user-a', 'trip-a')
    }
    if (action === 'remove' || action === 'remove and redownload') {
      await other.remove('user-a', 'trip-a')
      if (action === 'remove and redownload') replacement = await other.download('user-a', 'trip-a', mockClient().client)
    }
    if (action === 'invalidate') await other.invalidateUser('user-a')
    if (action === 'other user') await other.invalidateOtherUsers('user-b')
    photo.resolve({ data: new Blob(['test'], { type: 'image/jpeg' }), error: null })
    await rejected
    expect(await other.get('user-a', 'trip-a')).toEqual(replacement)
    expect(await other.getActive()).toEqual(replacement)
  })

  it.each(['logout', 'remove', 'invalidate'])('synchronously invalidates %s work even if the subsequent storage operation fails', async action => {
    const old = await savedCopy()
    const other = new OfflineDownloads({ databaseName: name })
    connections.push(other)
    const entered = deferred<void>()
    const photo = deferred<Response>()
    const pending = downloads.download('user-a', 'trip-a', mockClient({
      photo: async () => { entered.resolve(); return photo.promise },
    }).client)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await entered.promise
    const transaction = vi.spyOn(Dexie.prototype, 'transaction').mockRejectedValueOnce(new Error('Storage unavailable'))
    const invalidation = action === 'logout' ? other.clearAll() : action === 'remove' ?
      other.remove('user-a', 'trip-a') : other.invalidateUser('user-a')
    await expect(invalidation).rejects.toThrow('Storage unavailable')
    transaction.mockRestore()
    photo.resolve({ data: new Blob(['test'], { type: 'image/jpeg' }), error: null })
    await rejected
    expect(await downloads.getActive()).toEqual(old)
  })

  it.each(['logout', 'remove', 'switch', 'other user'])('uses persisted generations for %s in an independently loaded module (another tab)', async action => {
    await savedCopy()
    const entered = deferred<void>()
    const photo = deferred<Response>()
    const pending = downloads.download('user-a', 'trip-a', mockClient({
      photo: async () => { entered.resolve(); return photo.promise },
    }).client)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await entered.promise
    vi.resetModules()
    const { OfflineDownloads: OtherTabDownloads } = await import('./downloads')
    const other = new OtherTabDownloads({ databaseName: name })
    connections.push(other)
    if (action === 'logout') await other.clearAll()
    if (action === 'remove') await other.remove('user-a', 'trip-a')
    if (action === 'switch') await other.rememberAccount('user-b', 'trip-b')
    if (action === 'other user') await other.invalidateOtherUsers('user-b')
    photo.resolve({ data: new Blob(['test'], { type: 'image/jpeg' }), error: null })
    await rejected
    expect(await other.getActive()).toBeUndefined()
  })

  it('does not churn generations or invalidate work for the same remembered account and trip', async () => {
    await downloads.rememberAccount('user-a', 'trip-a')
    const state = await inspectDatabase(db => db.table('control').get('state'))
    await downloads.rememberAccount('user-a', 'trip-a')
    expect(await inspectDatabase(db => db.table('control').get('state'))).toEqual(state)
    await downloads.download('user-a', 'trip-a', mockClient({ photo: async () => {
      await downloads.rememberAccount('user-a', 'trip-a')
      return { data: new Blob(['test'], { type: 'image/jpeg' }), error: null }
    } }).client)
    expect(await downloads.getActive()).toBeDefined()
  })

  it.each(['logout', 'remove', 'switch', 'invalidate', 'other user'])('notifies a subscriber after durable %s, including from an independently loaded module', async action => {
    await savedCopy()
    const listener = vi.fn()
    const unsubscribe = downloads.subscribe(listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { interval: 5 })
    listener.mockClear()
    vi.resetModules()
    const { OfflineDownloads: OtherTabDownloads } = await import('./downloads')
    const other = new OtherTabDownloads({ databaseName: name })
    connections.push(other)
    if (action === 'logout') await other.clearAll()
    if (action === 'remove') await other.remove('user-a', 'trip-a')
    if (action === 'switch') await other.rememberAccount('user-b', 'trip-b')
    if (action === 'invalidate') await other.invalidateUser('user-a')
    if (action === 'other user') await other.invalidateOtherUsers('user-b')
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { interval: 5 })
    expect(listener.mock.calls).toEqual([[]])
    expect(await downloads.getActive()).toBeUndefined()
    unsubscribe()
  })

  it('notifies own successful downloads and refreshes without passing identities or notebook data to subscribers', async () => {
    await downloads.rememberAccount('user-a', 'trip-a')
    const listener = vi.fn()
    const unsubscribe = downloads.subscribe(listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { interval: 5 })
    listener.mockClear()
    await downloads.download('user-a', 'trip-a', mockClient().client)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { interval: 5 })
    const first = await downloads.getActive()
    await downloads.download('user-a', 'trip-a', mockClient().client)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2), { interval: 5 })
    expect((await downloads.getActive())!.revision).not.toBe(first!.revision)
    expect(listener.mock.calls).toEqual([[], []])
    unsubscribe()
  })

  it('does not notify for reads, same identity, no-op removal, failed refresh, or after unsubscribe', async () => {
    await savedCopy()
    const listener = vi.fn()
    const unsubscribe = downloads.subscribe(listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { interval: 5 })
    listener.mockClear()
    await downloads.getActive()
    await downloads.get('user-a', 'trip-a')
    await downloads.rememberAccount('user-a', 'trip-a')
    await downloads.remove('user-a', 'absent-trip')
    await downloads.invalidateUser('absent-user')
    await downloads.invalidateOtherUsers('user-a')
    await expect(downloads.download('user-a', 'trip-a', mockClient({
      photo: async () => ({ data: null, error: new TypeError('Failed to fetch') }),
    }).client)).rejects.toThrow('Failed to fetch')
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
    await downloads.clearAll()
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not notify on no-op clear or an aborted quota-failed publication', async () => {
    const listener = vi.fn()
    const unsubscribe = downloads.subscribe(listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1), { interval: 5 })
    listener.mockClear()
    await downloads.clearAll()
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(listener).not.toHaveBeenCalled()
    await savedCopy()
    await vi.waitFor(() => expect(listener).toHaveBeenCalled(), { interval: 5 })
    await new Promise(resolve => setTimeout(resolve, 25))
    listener.mockClear()
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'snapshots') throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      return original.apply(this, args)
    })
    await expect(downloads.download('user-a', 'trip-a', mockClient().client)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('rejects downloads without a remembered verified identity', async () => {
    const { client, calls } = mockClient()
    await expect(downloads.download('user-a', 'trip-a', client)).rejects.toThrow('cancelled')
    expect(calls.auth).toBe(0)
  })

  it.each(['version', 'missing photo', 'size', 'MIME', 'relationship', 'timestamp'])('rejects persisted %s corruption rather than returning a usable copy', async corruption => {
    const copy = await savedCopy()
    await inspectDatabase(async db => {
      const invalid: Record<string, unknown> = { ...structuredClone(copy) }
      if (corruption === 'version') invalid.schemaVersion = 999
      if (corruption === 'timestamp') invalid.savedAt = 'invalid'
      if (corruption === 'missing photo') Reflect.deleteProperty(copy.notebook.photos[0], 'blob')
      if (corruption === 'size') copy.notebook.photos[0].size = 800
      if (corruption === 'MIME') copy.notebook.photos[0].blob = new Blob(['test'], { type: 'image/png' })
      if (corruption === 'relationship') copy.notebook.items[0].dayId = 'not-a-day'
      if (!['version', 'timestamp'].includes(corruption)) invalid.notebook = copy.notebook
      await db.table('snapshots').put(invalid)
    })
    await expect(downloads.getActive()).rejects.toThrow()
    await expect(downloads.get('user-a', 'trip-a')).rejects.toThrow()
  })

  it('does not open or modify the legacy notebook database', async () => {
    const legacy = new Dexie(`legacy-sentinel-${name}`)
    legacy.version(1).stores({ sentinel: 'id' })
    try {
      await legacy.table('sentinel').put({ id: 'keep', value: 'private old data' })
      const open = vi.spyOn(indexedDB, 'open')
      await savedCopy()
      await downloads.clearAll()
      expect(open.mock.calls.every(([database]) => database === name)).toBe(true)
      expect(await legacy.table('sentinel').get('keep')).toEqual({ id: 'keep', value: 'private old data' })
    } finally { await legacy.delete() }
  })
})

describe('offline notebook validation', () => {
  it.each([
    ['duplicate IDs', (raw: ReturnType<typeof metadataFixture>) => raw.places.push(raw.places[0])],
    ['missing day', (raw: ReturnType<typeof metadataFixture>) => { raw.items[0].dayId = 'missing' }],
    ['invalid stamp choice', (raw: ReturnType<typeof metadataFixture>) => { Reflect.set(raw.stamps[0], 'stampKind', 'unknown') }],
    ['invalid optional field', (raw: ReturnType<typeof metadataFixture>) => { Reflect.set(raw.checklist[0], 'note', 4) }],
    ['invalid booking status', (raw: ReturnType<typeof metadataFixture>) => { Reflect.set(raw.items[0], 'bookingStatus', 'unknown') }],
    ['parent cycle', (raw: ReturnType<typeof metadataFixture>) => { raw.items[0].parentId = 'item-a' }],
    ['missing rate snapshot', (raw: ReturnType<typeof metadataFixture>) => { raw.expenses[0].rateSetId = 'missing' }],
    ['invalid rate', (raw: ReturnType<typeof metadataFixture>) => { raw.rateSets[0].kesPerUsd = 0 }],
    ['missing stamp', (raw: ReturnType<typeof metadataFixture>) => { raw.photos[0].stampId = 'missing' }],
    ['inconsistent detachment', (raw: ReturnType<typeof metadataFixture>) => { raw.stamps[0].detached = true }],
    ['invalid date', (raw: ReturnType<typeof metadataFixture>) => { raw.days[0].date = '2026-02-30' }],
    ['other trip path', (raw: ReturnType<typeof metadataFixture>) => { raw.photos[0].storagePath = 'trip-b/photo-a-version.jpg' }],
    ['no path fallback', (raw: ReturnType<typeof metadataFixture>) => { Reflect.deleteProperty(raw.photos[0], 'storagePath') }],
    ['unsupported schema', (raw: ReturnType<typeof metadataFixture>) => { Reflect.set(raw, 'schemaVersion', 5) }],
    ['missing template stop place', (raw: ReturnType<typeof metadataFixture>) => { raw.activityTemplates[0].stops[0].placeId = 'missing' }],
    ['duplicate metadata', (raw: ReturnType<typeof metadataFixture>) => { raw.metadata.push(raw.metadata[0]) }],
  ])('rejects %s', (_label, mutate) => {
    const raw = metadataFixture()
    mutate(raw)
    expect(() => validateCloudNotebook(raw, 'trip-a')).toThrow('Invalid downloaded notebook')
  })

  it('validates complete local shape without adding or discarding metadata', () => {
    const raw = metadataFixture()
    const value = { ...raw, photos: raw.photos.map(photo => ({ ...photo, blob: new Blob(['test'], { type: 'image/jpeg' }) })) }
    const before = structuredClone(value)
    validateDownloadedNotebook(value, 'trip-a')
    expect(value).toEqual(before)
  })

  it('distinguishes authorization failures from fetch and timeout failures', () => {
    for (const error of [{ status: 401 }, { statusCode: '403' }, { code: 'PGRST301' }, new Error('JWT expired'), new Error('Invalid JWT')]) {
      expect(isAuthorizationError(error)).toBe(true)
    }
    for (const error of [new TypeError('Failed to fetch'), new Error('Request timed out'), { status: 500 }, null]) {
      expect(isAuthorizationError(error)).toBe(false)
    }
  })

  it('recognizes the SQL membership denial without confusing expired authentication or transport failures', () => {
    const denial = { status: 400, code: 'P0001', message: 'Trip membership with edit access is required' }
    expect(isAuthorizationError(denial)).toBe(true)
    expect(isMembershipRevokedError(denial)).toBe(true)
    expect(isMembershipRevokedError(new Error(denial.message))).toBe(true)
    expect(isMembershipRevokedError({ status: 403 })).toBe(true)
    for (const error of [{ status: 401 }, { code: 'PGRST301', message: 'JWT expired' }, { code: 'P0001', message: 'Invalid trip data' }, new TypeError('Failed to fetch')]) {
      expect(isMembershipRevokedError(error)).toBe(false)
    }
  })
})
