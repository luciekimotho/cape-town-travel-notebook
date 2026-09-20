import type { SupabaseClient } from '@supabase/supabase-js'
import type { CloudNotebookMetadata } from './validation'

const now = '2026-09-01T10:00:00.000Z'

export function metadataFixture(): CloudNotebookMetadata {
  return {
    schemaVersion: 4,
    trip: { id: 'current', destination: 'Cape Town', travellers: 2, startDate: '2026-09-21', endDate: '2026-09-28', timezone: 'Africa/Johannesburg', notes: 'Keep every field', updatedAt: now },
    checklist: [{ id: 'check-a', title: 'Passport', category: 'Travel', dueDate: '2026-09-20', completed: true, note: 'Packed', createdAt: now, updatedAt: now }],
    days: [{ id: 'day-a', date: '2026-09-21', outOfRange: false }],
    places: [{ id: 'place-a', name: 'Mountain', stampKind: 'mountain', address: 'Table Mountain', notes: 'Cable car', googleMapsUrl: 'https://maps.google.com/', wantToVisit: false, seeded: true, createdAt: now, updatedAt: now }],
    activityTemplates: [{ id: 'template-a', name: 'Mountain day', stampKind: 'auto', description: 'A day out', stops: [{ id: 'stop-a', placeName: 'Mountain', placeId: 'place-a', notes: ['Bring water', 'Book ahead'], approximateMinutes: 90, optional: true }], seeded: false, createdAt: now, updatedAt: now }],
    items: [
      { id: 'group-a', dayId: 'day-a', placeId: 'place-a', stampKind: 'auto', templateId: 'template-a', isActivityGroup: true, time: '08:30', linkUrl: 'https://www.getyourguide.com/cape-town-l103/example-t123/', notes: 'Day trip', bookingStatus: 'Confirmed', visited: false, position: 0, createdAt: now, updatedAt: now },
      { id: 'item-a', dayId: 'day-a', placeId: 'place-a', stampKind: 'pin', parentId: 'group-a', templateId: 'template-a', isActivityGroup: false, time: '09:30', notes: 'View', bookingStatus: 'Booked', visited: true, position: 1, createdAt: now, updatedAt: now },
    ],
    expenses: [{ id: 'expense-a', amount: 120.5, currency: 'ZAR', date: '2026-09-21', category: 'Activity', note: 'Tickets', rateSetId: 'rate-old', itineraryItemId: 'item-a', createdAt: now, updatedAt: now }],
    stamps: [{ id: 'stamp-a', itineraryItemId: 'item-a', placeName: 'Mountain', stampKind: 'mountain', visitDate: '2026-09-21', detached: false, createdAt: now }],
    photos: [{ id: 'photo-a', stampId: 'stamp-a', caption: 'The view', mimeType: 'image/jpeg', width: 120, height: 90, size: 4, storagePath: 'trip-a/photo-a-version.jpg', createdAt: now, updatedAt: now }],
    rateSets: [
      { id: 'rate-old', label: 'Recorded rate', effectiveDate: '2026-09-01', kesPerKes: 1, kesPerUsd: 120, kesPerZar: 7.25, active: false, example: false, createdAt: now },
      { id: 'rate-new', label: 'Current rate', effectiveDate: '2026-09-02', kesPerKes: 1, kesPerUsd: 125, kesPerZar: 7.5, active: true, example: false, createdAt: now },
    ],
    metadata: [{ key: 'schemaVersion', value: '4' }, { key: 'displayCurrency', value: 'KES' }, { key: 'custom', value: 'Preserve me' }],
  }
}

export interface Response { data: unknown; error: unknown }

export function mockClient(options: {
  notebook?: CloudNotebookMetadata
  userId?: string
  auth?: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>
  membership?: () => Promise<Response>
  load?: () => Promise<Response>
  photo?: (path: string, parameters?: { signal?: AbortSignal; cache?: string }) => Promise<Response>
} = {}) {
  const calls = { auth: 0, membership: 0, load: 0, photos: [] as string[], signals: [] as AbortSignal[] }
  const raw = options.notebook ?? metadataFixture()
  const client = {
    auth: {
      getUser: async () => {
        calls.auth++
        return options.auth ? options.auth() : { data: { user: { id: options.userId ?? 'user-a' } }, error: null }
      },
    },
    rpc: (name: string) => {
      const operation = async () => {
        if (name === 'list_notebook_trips') {
          calls.membership++
          return options.membership ? options.membership() : { data: [{ id: 'trip-a', role: 'owner' }], error: null }
        }
        if (name !== 'load_notebook_v6') throw new Error(`Unexpected RPC ${name}`)
        calls.load++
        return options.load ? options.load() : { data: structuredClone(raw), error: null }
      }
      return { abortSignal: (signal: AbortSignal) => { calls.signals.push(signal); return operation() } }
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'trip-photos') throw new Error('Unexpected bucket')
        return {
          download: async (path: string, _options: object, parameters?: { signal?: AbortSignal; cache?: string }) => {
            calls.photos.push(path)
            if (parameters?.cache !== 'no-store') throw new Error('Private photos must not be cached by HTTP')
            return options.photo ? options.photo(path, parameters) : { data: new Blob(['test'], { type: 'image/jpeg' }), error: null }
          },
        }
      },
    },
  } as unknown as SupabaseClient
  return { client, calls, raw }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
