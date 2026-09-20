import Dexie, { liveQuery, type Table } from 'dexie'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, PhotoEntry } from '../types'
import { canonicalMetadata, validateCloudNotebook, validateDownloadedNotebook } from './validation'

export const DOWNLOAD_DATABASE_NAME = 'cape-town-private-trip-downloads'
export const DOWNLOAD_SCHEMA_VERSION = 1

export interface DownloadedTrip {
  schemaVersion: typeof DOWNLOAD_SCHEMA_VERSION
  userId: string
  tripId: string
  savedAt: string
  revision?: string
  notebook: AppData
}

interface Identity { userId: string; tripId: string }
interface Control {
  key: 'state'
  generation: string
  identity?: Identity
}
interface Lease extends Identity { token: string }
interface LocalEpoch { all: string; user?: string; trip?: string }
interface Ticket extends Identity { generation: string; token: string; localEpoch: LocalEpoch }
interface LocalInvalidations {
  all: string
  users: Map<string, string>
  trips: Map<string, string>
}

// Shared across instances in this tab; persisted control/leases cover other tabs.
const localInvalidations = new Map<string, LocalInvalidations>()
const identityKey = (userId: string, tripId: string) => JSON.stringify([userId, tripId])

class DownloadDatabase extends Dexie {
  snapshots!: Table<DownloadedTrip, [string, string]>
  control!: Table<Control, string>
  leases!: Table<Lease, [string, string]>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      snapshots: '[userId+tripId], userId',
      control: 'key',
      leases: '[userId+tripId], userId',
    })
  }
}

function requireIdentity(userId: string, tripId: string) {
  if (!userId.trim() || !tripId.trim()) throw new Error('A verified account and trip are required.')
}

function invalidated(): Error {
  return new Error('Download cancelled because this account or downloaded trip changed.')
}

function authorizationError(): Error & { status: number } {
  return Object.assign(new Error('The signed-in account no longer has access to this trip.'), { status: 403 })
}

export function isMembershipRevokedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const detail = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  return detail.status === 403 || detail.status === '403' || detail.statusCode === 403 || detail.statusCode === '403' ||
    detail.message === 'Trip membership with edit access is required'
}

export function isAuthorizationError(error: unknown): boolean {
  if (isMembershipRevokedError(error)) return true
  if (!error || typeof error !== 'object') return false
  const detail = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown }
  if ([401, 403, '401', '403'].includes(detail.status as string | number) ||
    [401, 403, '401', '403'].includes(detail.statusCode as string | number)) return true
  if (typeof detail.code === 'string' && [
    'PGRST301', 'PGRST302', 'PGRST303', 'bad_jwt', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used',
  ].includes(detail.code)) return true
  return typeof detail.message === 'string' && /\bJWT\b.*\b(expired|invalid|missing)\b|\b(expired|invalid|missing)\b.*\bJWT\b/i.test(detail.message)
}

function validateSnapshot(value: DownloadedTrip, userId: string, tripId: string): void {
  if (!value || value.schemaVersion !== DOWNLOAD_SCHEMA_VERSION || value.userId !== userId ||
    value.tripId !== tripId || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) ||
    (value.revision !== undefined && (typeof value.revision !== 'string' || !value.revision))) {
    throw new Error('The downloaded trip has an unsupported version or corrupt metadata. Download it again while online.')
  }
  validateDownloadedNotebook(value.notebook, tripId)
}

/** No credentials are stored here. Identity must only be remembered after server verification. */
export class OfflineDownloads {
  private readonly db: DownloadDatabase
  private readonly invalidations: LocalInvalidations
  private readonly requestTimeoutMs: number
  private readonly downloadTimeoutMs: number
  private readonly subscriptions = new Set<() => void>()

  constructor(options: { databaseName?: string; requestTimeoutMs?: number; downloadTimeoutMs?: number } = {}) {
    const name = options.databaseName ?? DOWNLOAD_DATABASE_NAME
    this.db = new DownloadDatabase(name)
    const existing = localInvalidations.get(name)
    this.invalidations = existing ?? { all: crypto.randomUUID(), users: new Map(), trips: new Map() }
    if (!existing) localInvalidations.set(name, this.invalidations)
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 120_000
  }

  private localEpoch(userId: string, tripId: string): LocalEpoch {
    return {
      all: this.invalidations.all,
      user: this.invalidations.users.get(userId),
      trip: this.invalidations.trips.get(identityKey(userId, tripId)),
    }
  }

  private checkLocalTicket(ticket: Ticket): void {
    const current = this.localEpoch(ticket.userId, ticket.tripId)
    if (current.all !== ticket.localEpoch.all || current.user !== ticket.localEpoch.user ||
      current.trip !== ticket.localEpoch.trip) throw invalidated()
  }

  private invalidateLocally(): void {
    this.invalidations.all = crypto.randomUUID()
    this.invalidations.users.clear()
    this.invalidations.trips.clear()
  }

  private async state(): Promise<Control | undefined> {
    const state = await this.db.control.get('state')
    if (state && (state.key !== 'state' || typeof state.generation !== 'string' || !state.generation ||
      (state.identity !== undefined && (!state.identity || typeof state.identity.userId !== 'string' ||
        !state.identity.userId || typeof state.identity.tripId !== 'string' || !state.identity.tripId)))) {
      throw new Error('The downloaded account record is corrupt. Clear downloaded trips before continuing.')
    }
    return state
  }

  /**
   * Emits once after reading the initial state, then after durable identity/copy changes.
   * No data is passed to listeners; re-read getActive(), treating read failures as unavailable.
   * Dexie propagates committed IndexedDB mutations across tabs without broadcasting snapshots.
   */
  subscribe(listener: () => void): () => void {
    let previous: string | undefined
    const subscription = liveQuery(() => this.db.transaction('r', this.db.control, this.db.snapshots, async () => {
      const state = await this.state()
      const snapshots = await this.db.snapshots.toArray()
      return canonicalMetadata({
        identity: state?.identity ?? null,
        snapshots: snapshots.map(({ userId, tripId, schemaVersion, savedAt, revision }) =>
          ({ userId, tripId, schemaVersion, savedAt, revision: revision ?? null })),
      })
    })).subscribe({
      next: current => {
        if (previous !== current) {
          previous = current
          listener()
        }
      },
      // The observer cannot safely establish visibility; ask the consumer to re-read and fail closed.
      error: () => listener(),
    })
    const unsubscribe = () => {
      subscription.unsubscribe()
      this.subscriptions.delete(unsubscribe)
    }
    this.subscriptions.add(unsubscribe)
    return unsubscribe
  }

  async rememberAccount(userId: string, tripId: string): Promise<void> {
    requireIdentity(userId, tripId)
    await this.db.transaction('rw', this.db.control, this.db.snapshots, this.db.leases, async () => {
      const state = await this.state()
      if (state?.identity?.userId === userId && state.identity.tripId === tripId) return
      this.invalidateLocally()
      if (state?.identity?.userId !== userId) {
        await this.db.snapshots.clear()
        await this.db.leases.clear()
      }
      await this.db.control.put({ key: 'state', generation: crypto.randomUUID(), identity: { userId, tripId } })
    })
  }

  async getActive(): Promise<DownloadedTrip | undefined> {
    return this.db.transaction('r', this.db.control, this.db.snapshots, async () => {
      const state = await this.state()
      if (!state?.identity) return undefined
      return this.readSnapshot(state.identity.userId, state.identity.tripId)
    })
  }

  async get(userId: string, tripId: string): Promise<DownloadedTrip | undefined> {
    requireIdentity(userId, tripId)
    return this.db.transaction('r', this.db.control, this.db.snapshots, async () => {
      const state = await this.state()
      if (state?.identity?.userId !== userId) return undefined
      return this.readSnapshot(userId, tripId)
    })
  }

  private async readSnapshot(userId: string, tripId: string): Promise<DownloadedTrip | undefined> {
    const snapshot = await this.db.snapshots.get([userId, tripId])
    if (snapshot === undefined) return undefined
    validateSnapshot(snapshot, userId, tripId)
    return structuredClone(snapshot)
  }

  async remove(userId: string, tripId: string): Promise<void> {
    requireIdentity(userId, tripId)
    this.invalidations.trips.set(identityKey(userId, tripId), crypto.randomUUID())
    await this.db.transaction('rw', this.db.snapshots, this.db.leases, async () => {
      await this.db.snapshots.delete([userId, tripId])
      await this.db.leases.delete([userId, tripId])
    })
  }

  async clearAll(): Promise<void> {
    this.invalidateLocally()
    await this.db.transaction('rw', this.db.control, this.db.snapshots, this.db.leases, async () => {
      await this.db.snapshots.clear()
      await this.db.leases.clear()
      // Never delete the generation: an old tab may still have a pending network request.
      await this.db.control.put({ key: 'state', generation: crypto.randomUUID() })
    })
  }

  async invalidateUser(userId: string): Promise<void> {
    if (!userId.trim()) throw new Error('An account ID is required.')
    this.invalidations.users.set(userId, crypto.randomUUID())
    await this.db.transaction('rw', this.db.control, this.db.snapshots, this.db.leases, async () => {
      const state = await this.state()
      await this.db.snapshots.where('userId').equals(userId).delete()
      await this.db.leases.where('userId').equals(userId).delete()
      if (state?.identity?.userId === userId) {
        await this.db.control.put({ key: 'state', generation: crypto.randomUUID() })
      }
    })
  }

  /** Call after getUser verification, even when the verified account has no trips. */
  async invalidateOtherUsers(verifiedUserId: string): Promise<void> {
    if (!verifiedUserId.trim()) throw new Error('A verified account ID is required.')
    await this.db.transaction('rw', this.db.control, this.db.snapshots, this.db.leases, async () => {
      const state = await this.state()
      if (state?.identity && state.identity.userId !== verifiedUserId) {
        this.invalidateLocally()
        await this.db.control.put({ key: 'state', generation: crypto.randomUUID() })
      }
      await this.db.snapshots.where('userId').notEqual(verifiedUserId).delete()
      await this.db.leases.where('userId').notEqual(verifiedUserId).delete()
    })
  }

  private async begin(userId: string, tripId: string): Promise<Ticket> {
    const localEpoch = this.localEpoch(userId, tripId)
    return this.db.transaction('rw', this.db.control, this.db.leases, async () => {
      const state = await this.state()
      if (state?.identity?.userId !== userId || state.identity.tripId !== tripId) throw invalidated()
      const token = crypto.randomUUID()
      await this.db.leases.put({ userId, tripId, token })
      return { userId, tripId, token, generation: state.generation, localEpoch }
    })
  }

  private async checkTicket(ticket: Ticket): Promise<void> {
    this.checkLocalTicket(ticket)
    const state = await this.state()
    const lease = await this.db.leases.get([ticket.userId, ticket.tripId])
    if (state?.generation !== ticket.generation || state.identity?.userId !== ticket.userId ||
      state.identity.tripId !== ticket.tripId || lease?.token !== ticket.token) throw invalidated()
    this.checkLocalTicket(ticket)
  }

  async download(
    userId: string,
    tripId: string,
    client: SupabaseClient,
    onProgress?: (message: string) => void,
  ): Promise<DownloadedTrip> {
    requireIdentity(userId, tripId)
    const ticket = await this.begin(userId, tripId)
    const deadline = Date.now() + this.downloadTimeoutMs
    const controller = new AbortController()
    const request = async <T>(operation: () => PromiseLike<T>): Promise<T> => {
      this.checkLocalTicket(ticket)
      const remaining = Math.min(this.requestTimeoutMs, deadline - Date.now())
      if (remaining <= 0) throw new Error('The trip download timed out. The previous download has not changed.')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new Error('The trip download timed out. The previous download has not changed.'))
            }, remaining)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    const rpc = async (name: 'list_notebook_trips' | 'load_notebook_v5') => {
      const response = await request(() => client.rpc(name, name === 'load_notebook_v5' ? { p_trip_id: tripId } : undefined)
        .abortSignal(controller.signal))
      if (response.error) throw response.error
      return response.data as unknown
    }
    const verifyAccess = async () => {
      // getUser verifies with the auth server; getSession alone is deliberately insufficient.
      const { data, error } = await request(() => client.auth.getUser())
      if (error) throw error
      if (data.user?.id !== userId) throw authorizationError()
      const trips = await rpc('list_notebook_trips')
      if (!Array.isArray(trips)) throw new Error('The server returned invalid trip membership data.')
      if (!trips.some(trip => trip && typeof trip === 'object' && trip.id === tripId &&
        (trip.role === 'owner' || trip.role === 'editor'))) throw authorizationError()
    }
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.db.transaction('r', this.db.control, this.db.leases, () => this.checkTicket(ticket))
        onProgress?.(attempt ? 'The trip changed. Retrying a complete download…' : 'Checking access to this trip…')
        await verifyAccess()
        onProgress?.('Downloading the complete notebook…')
        const raw = await rpc('load_notebook_v5')
        validateCloudNotebook(raw, tripId)
        const before = canonicalMetadata(raw)
        const photos: PhotoEntry[] = []
        for (const [index, photo] of raw.photos.entries()) {
          onProgress?.(`Downloading photo ${index + 1} of ${raw.photos.length}…`)
          const { data: blob, error } = await request(() =>
            client.storage.from('trip-photos').download(photo.storagePath, {}, { signal: controller.signal, cache: 'no-store' }))
          if (error) throw error
          if (!(blob instanceof Blob) || blob.size !== photo.size || blob.type !== photo.mimeType) {
            throw new Error('A trip photo is missing or its bytes do not match the notebook. The previous download has not changed.')
          }
          photos.push({ ...photo, blob })
        }
        onProgress?.('Verifying the complete download…')
        const after = await rpc('load_notebook_v5')
        validateCloudNotebook(after, tripId)
        await verifyAccess()
        if (before !== canonicalMetadata(after)) {
          if (attempt < 2) continue
          throw new Error('The trip kept changing during download. Try again. The previous download has not changed.')
        }
        const notebook: AppData = { ...raw, photos }
        validateDownloadedNotebook(notebook, tripId)
        const snapshot: DownloadedTrip = {
          schemaVersion: DOWNLOAD_SCHEMA_VERSION, userId, tripId, savedAt: new Date().toISOString(),
          revision: crypto.randomUUID(), notebook,
        }
        onProgress?.('Saving this verified trip on this device…')
        await this.db.transaction('rw', this.db.control, this.db.leases, this.db.snapshots, async () => {
          await this.checkTicket(ticket)
          await this.db.snapshots.put(snapshot)
          this.checkLocalTicket(ticket)
        })
        this.checkLocalTicket(ticket)
        return structuredClone(snapshot)
      }
      throw new Error('The trip could not be downloaded.')
    } finally {
      controller.abort()
    }
  }

  /** Release this connection (primarily useful for isolated tests and disposable clients). */
  close(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.db.close()
  }
}

export const offlineDownloads = new OfflineDownloads()
