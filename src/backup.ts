import JSZip from 'jszip'
import { replaceAll } from './db'
import { isStampDesign, validateNotebookStampDesigns } from './stampDesign'
import type { AppData, BackupData, PhotoEntry } from './types'

const photoPath = (photo: Pick<PhotoEntry, 'id' | 'mimeType'>) => `photos/${photo.id}.${photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'}`

export async function createBackup(data: AppData): Promise<Blob> {
  validateNotebookStampDesigns(data)
  const zip = new JSZip()
  const metadata = data.metadata.filter(entry => entry.key !== 'schemaVersion')
  metadata.push({ key: 'schemaVersion', value: '4' })
  const backup: BackupData = { schemaVersion: 4, exportedAt: new Date().toISOString(), trip: data.trip, checklist: data.checklist, days: data.days, items: data.items, places: data.places, activityTemplates: data.activityTemplates, expenses: data.expenses, stamps: data.stamps, photos: data.photos.map(({ blob: _blob, ...photo }) => photo), rateSets: data.rateSets, metadata }
  zip.file('notebook.json', JSON.stringify(backup, null, 2))
  data.photos.forEach(photo => zip.file(photoPath(photo), photo.blob))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

const arrays = ['checklist', 'days', 'items', 'places', 'activityTemplates', 'expenses', 'stamps', 'photos', 'rateSets', 'metadata'] as const
const isString = (value: unknown): value is string => typeof value === 'string'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>

function validateRecords(backup: Partial<Omit<BackupData, 'schemaVersion'>>) {
  const checks: Record<(typeof arrays)[number], (value: Record<string, unknown>) => boolean> = {
    checklist: value => isString(value.id) && isString(value.title) && isString(value.category) && isBoolean(value.completed) && isString(value.createdAt) && isString(value.updatedAt),
    days: value => isString(value.id) && isString(value.date) && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && isBoolean(value.outOfRange),
    items: value => isString(value.id) && isString(value.dayId) && isString(value.placeId) && (value.bookingStatus === undefined || isString(value.bookingStatus)) && isBoolean(value.visited) && isNumber(value.position),
    places: value => isString(value.id) && isString(value.name) && isBoolean(value.wantToVisit) && isString(value.createdAt) && isString(value.updatedAt),
    activityTemplates: value => isString(value.id) && isString(value.name) && isString(value.description) && Array.isArray(value.stops) && value.stops.every(item => {
      const stop = record(item)
      return isString(stop.id) && isString(stop.placeName) && Array.isArray(stop.notes) && stop.notes.every(isString)
    }) && isBoolean(value.seeded),
    expenses: value => isString(value.id) && isNumber(value.amount) && value.amount >= 0 && ['KES','USD','ZAR'].includes(String(value.currency)) && isString(value.date) && isString(value.category) && (value.itineraryItemId === undefined || isString(value.itineraryItemId)),
    stamps: value => isString(value.id) && isString(value.placeName) && isString(value.visitDate) && isBoolean(value.detached) && isString(value.createdAt),
    photos: value => isString(value.id) && isString(value.stampId) && isString(value.caption) && ['image/jpeg','image/png','image/webp'].includes(String(value.mimeType)) && isNumber(value.width) && isNumber(value.height) && isNumber(value.size),
    rateSets: value => isString(value.id) && isString(value.label) && isString(value.effectiveDate) && isNumber(value.kesPerKes) && isNumber(value.kesPerUsd) && isNumber(value.kesPerZar) && isBoolean(value.active) && isBoolean(value.example),
    metadata: value => isString(value.key) && isString(value.value),
  }
  for (const key of arrays) {
    if (['places', 'items', 'activityTemplates', 'stamps'].includes(key) &&
      !backup[key]!.every(item => item && typeof item === 'object' &&
        (record(item).stampKind === undefined || isStampDesign(record(item).stampKind)))) {
      throw new Error(`Backup field "${key}" contains an invalid stamp design.`)
    }
    if (!backup[key]!.every(item => item && typeof item === 'object' && checks[key](record(item)))) {
      throw new Error(`Backup field "${key}" contains invalid records.`)
    }
    const linkedExpenseIds = backup.expenses!
      .map(expense => expense.itineraryItemId)
      .filter((id): id is string => id !== undefined)
    if (new Set(linkedExpenseIds).size !== linkedExpenseIds.length) {
      throw new Error('Backup contains more than one expense linked to the same itinerary item.')
    }
  }
}

export async function parseBackup(file: File): Promise<AppData> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(file) } catch { throw new Error('This is not a readable ZIP backup.') }
  const jsonFile = zip.file('notebook.json')
  if (!jsonFile) throw new Error('Backup is missing notebook.json.')
  let raw: unknown
  try { raw = JSON.parse(await jsonFile.async('text')) } catch { throw new Error('Backup JSON is invalid.') }
  if (!raw || typeof raw !== 'object') throw new Error('Backup data is invalid.')
  const backup = raw as Partial<Omit<BackupData, 'schemaVersion'>> & { schemaVersion?: number }
  if (backup.schemaVersion !== 1 && backup.schemaVersion !== 2 && backup.schemaVersion !== 3 && backup.schemaVersion !== 4) throw new Error('Unsupported backup version.')
  if (backup.schemaVersion === 1 && !('activityTemplates' in backup)) {
    backup.activityTemplates = []
  }
  if (!backup.trip || backup.trip.id !== 'current' || typeof backup.trip.destination !== 'string') throw new Error('Backup trip data is invalid.')
  for (const key of arrays) if (!Array.isArray(backup[key])) throw new Error(`Backup field "${key}" is invalid.`)
  validateRecords(backup)
  const photos: PhotoEntry[] = []
  for (const metadata of backup.photos!) {
    if (!metadata || typeof metadata.id !== 'string' || typeof metadata.mimeType !== 'string') throw new Error('Photo metadata is invalid.')
    const stored = zip.file(photoPath(metadata))
    if (!stored) throw new Error(`Photo file for "${metadata.id}" is missing.`)
    const blob = await stored.async('blob')
    if (blob.size !== metadata.size) throw new Error(`Photo file for "${metadata.id}" has the wrong size.`)
    photos.push({ ...metadata, blob })
  }
  const metadata = backup.metadata!.filter(entry => entry.key !== 'schemaVersion')
  metadata.push({ key: 'schemaVersion', value: '4' })
  return { trip: backup.trip, checklist: backup.checklist!, days: backup.days!, items: backup.items!, places: backup.places!, activityTemplates: backup.activityTemplates!, expenses: backup.expenses!, stamps: backup.stamps!, photos, rateSets: backup.rateSets!, metadata }
}
export const restoreBackup = (data: AppData) => replaceAll(data)
