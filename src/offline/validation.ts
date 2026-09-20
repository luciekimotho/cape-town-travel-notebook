import { isStampDesign } from '../stampDesign'
import { isItineraryLink } from '../itineraryLink'
import type { AppData, PhotoEntry } from '../types'

export type CloudPhotoMetadata = Omit<PhotoEntry, 'blob'> & { storagePath: string }
export type CloudNotebookMetadata = Omit<AppData, 'photos'> & {
  schemaVersion: 4
  photos: CloudPhotoMetadata[]
}

type Row = Record<string, unknown>
type Check = (value: unknown) => boolean

const text: Check = value => typeof value === 'string'
const id: Check = value => typeof value === 'string' && value.trim().length > 0
const bool: Check = value => typeof value === 'boolean'
const number: Check = value => typeof value === 'number' && Number.isFinite(value)
const positive: Check = value => number(value) && Number(value) > 0
const integer: Check = value => Number.isSafeInteger(value) && Number(value) >= 0
const date: Check = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const timestamp: Check = value => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
const optional = (check: Check): Check => value => value === undefined || check(value)
const oneOf = (...values: unknown[]): Check => value => values.includes(value)
const mime = oneOf('image/jpeg', 'image/png', 'image/webp')
const timestamps = { createdAt: timestamp, updatedAt: timestamp }
const stampKind = optional(isStampDesign)

function fail(detail: string): never {
  throw new Error(`Invalid downloaded notebook: ${detail}.`)
}

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label)
  return value as Row
}

function fields(value: unknown, checks: Record<string, Check>, label: string): Row {
  const row = object(value, label)
  for (const [key, check] of Object.entries(checks)) {
    if (!check(row[key])) fail(`${label}.${key}`)
  }
  return row
}

function rows(root: Row, name: string, checks: Record<string, Check>, key = 'id'): Row[] {
  const values = root[name]
  if (!Array.isArray(values)) fail(name)
  const seen = new Set<unknown>()
  return values.map(value => {
    const row = fields(value, checks, name)
    if (seen.has(row[key])) fail(`duplicate ${name}.${key}`)
    seen.add(row[key])
    return row
  })
}

function references(value: unknown, ids: Set<unknown>, label: string, required = false) {
  if ((required || value !== undefined) && !ids.has(value)) fail(`missing ${label}`)
}

function validate(value: unknown, blobs: boolean, tripId?: string): void {
  const root = object(value, 'notebook')
  if ((!blobs || root.schemaVersion !== undefined) && root.schemaVersion !== 4) fail('schema version')
  const trip = fields(root.trip, {
    id: oneOf('current'), destination: text, travellers: value => integer(value) && Number(value) > 0,
    startDate: date, endDate: date, timezone: id, notes: text, updatedAt: timestamp,
  }, 'trip')
  if (String(trip.startDate) > String(trip.endDate)) fail('trip date range')
  rows(root, 'checklist', {
    id, title: text, category: text, dueDate: optional(date), completed: bool, note: optional(text), ...timestamps,
  })
  const days = rows(root, 'days', { id, date, outOfRange: bool })
  const places = rows(root, 'places', {
    id, name: text, stampKind, address: optional(text), notes: optional(text), googleMapsUrl: optional(text),
    wantToVisit: bool, seeded: optional(bool), ...timestamps,
  })
  const templates = rows(root, 'activityTemplates', {
    id, name: text, stampKind, description: text, stops: Array.isArray, seeded: bool, ...timestamps,
  })
  const items = rows(root, 'items', {
    id, dayId: id, placeId: id, stampKind, parentId: optional(id), templateId: optional(id),
    isActivityGroup: optional(bool), time: optional(value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)),
    linkUrl: optional(isItineraryLink),
    notes: optional(text), bookingStatus: optional(oneOf('Idea', 'To book', 'Booked', 'Confirmed', 'Cancelled')),
    visited: bool, position: number, ...timestamps,
  })
  const rates = rows(root, 'rateSets', {
    id, label: text, effectiveDate: date, kesPerKes: oneOf(1), kesPerUsd: positive, kesPerZar: positive,
    active: bool, example: bool, createdAt: timestamp,
  })
  if (rates.filter(rate => rate.active).length > 1) fail('multiple active rate sets')
  const expenses = rows(root, 'expenses', {
    id, amount: value => number(value) && Number(value) >= 0, currency: oneOf('KES', 'USD', 'ZAR'), date,
    category: text, note: optional(text), rateSetId: optional(id), itineraryItemId: optional(id), ...timestamps,
  })
  const stamps = rows(root, 'stamps', {
    id, itineraryItemId: optional(id), placeName: text, stampKind, visitDate: date, detached: bool, createdAt: timestamp,
  })
  const photos = rows(root, 'photos', {
    id, stampId: id, caption: text, mimeType: mime, width: value => integer(value) && positive(value),
    height: value => integer(value) && positive(value),
    size: value => integer(value) && positive(value) && Number(value) <= 52_428_800, ...timestamps,
  })
  const metadata = rows(root, 'metadata', { key: id, value: text }, 'key')
  for (const entry of metadata) {
    if (entry.key === 'schemaVersion' && entry.value !== '4') fail('metadata schema version')
    if (entry.key === 'displayCurrency' && !oneOf('KES', 'USD', 'ZAR')(entry.value)) fail('display currency')
  }
  const dayIds = new Set(days.map(row => row.id))
  const placeIds = new Set(places.map(row => row.id))
  const templateIds = new Set(templates.map(row => row.id))
  const itemIds = new Set(items.map(row => row.id))
  const rateIds = new Set(rates.map(row => row.id))
  const stampIds = new Set(stamps.map(row => row.id))
  const itemsById = new Map(items.map(row => [row.id, row]))
  for (const item of items) {
    references(item.dayId, dayIds, 'item day', true)
    references(item.placeId, placeIds, 'item place', true)
    references(item.templateId, templateIds, 'item template')
    references(item.parentId, itemIds, 'item parent')
    if (item.parentId !== undefined) {
      const parent = itemsById.get(item.parentId)!
      if (parent.id === item.id || parent.parentId !== undefined || parent.dayId !== item.dayId || parent.isActivityGroup !== true) {
        fail('item parent relationship')
      }
    }
  }
  for (const template of templates) {
    for (const stop of rows(template, 'stops', {
      id, placeName: text, placeId: optional(id),
      notes: value => Array.isArray(value) && value.every(text),
      approximateMinutes: optional(value => integer(value) && positive(value)), optional: optional(bool),
    })) references(stop.placeId, placeIds, 'template stop place')
  }
  const linkedExpenses = new Set<unknown>()
  for (const expense of expenses) {
    references(expense.rateSetId, rateIds, 'expense rate snapshot')
    references(expense.itineraryItemId, itemIds, 'expense itinerary item')
    if (expense.itineraryItemId !== undefined) {
      if (linkedExpenses.has(expense.itineraryItemId)) fail('duplicate linked expense')
      linkedExpenses.add(expense.itineraryItemId)
    }
  }
  const linkedStamps = new Set<unknown>()
  for (const stamp of stamps) {
    references(stamp.itineraryItemId, itemIds, 'stamp itinerary item')
    if (stamp.detached !== (stamp.itineraryItemId === undefined)) fail('stamp detachment')
    if (stamp.itineraryItemId !== undefined) {
      if (linkedStamps.has(stamp.itineraryItemId)) fail('duplicate linked stamp')
      linkedStamps.add(stamp.itineraryItemId)
    }
  }
  const paths = new Set<unknown>()
  for (const photo of photos) {
    references(photo.stampId, stampIds, 'photo stamp', true)
    if (!blobs || photo.storagePath !== undefined) {
      const path = photo.storagePath
      if (typeof path !== 'string' || !tripId || !path.startsWith(`${tripId}/`) ||
        path.split('/').length !== 2 || /[\\?#]/.test(path) ||
        [...path].some(character => character.charCodeAt(0) < 32) || path.includes('..')) fail('photo storage path')
      const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
      const file = path.slice(tripId.length + 1)
      // Existing migrated objects can have an unversioned name; never invent a fallback path.
      if (!(file === `${photo.id}.${extension}` ||
        (file.startsWith(`${photo.id}-`) && file.endsWith(`.${extension}`) &&
          file.length > String(photo.id).length + extension.length + 2))) fail('photo storage path')
      if (paths.has(path)) fail('duplicate photo storage path')
      paths.add(path)
    }
    if (blobs) {
      if (!(photo.blob instanceof Blob) || photo.blob.size !== photo.size) fail('photo blob size')
      if (photo.blob.type !== photo.mimeType) fail('photo blob MIME type')
    }
  }
}

export function validateCloudNotebook(value: unknown, tripId: string): asserts value is CloudNotebookMetadata {
  validate(value, false, tripId)
}

export function validateDownloadedNotebook(value: unknown, tripId: string): asserts value is AppData {
  validate(value, true, tripId)
}

/** Compare every raw metadata field, ignoring object key ordering but not array ordering. */
export function canonicalMetadata(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalMetadata).join(',')}]`
  const row = value as Row
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalMetadata(row[key])}`).join(',')}}`
}
