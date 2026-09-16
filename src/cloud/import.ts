import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, PhotoEntry } from '../types'
import { getCloudClient } from './client'

export interface ImportSummary {
  destination: string
  records: number
  photos: number
  photoBytes: number
  counts: Record<string, number>
}

const extensionFor = (photo: PhotoEntry) => photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
const sha256 = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(await blob.arrayBuffer()))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function summarizeImport(data: AppData): ImportSummary {
  const counts = {
    checklist: data.checklist.length,
    days: data.days.length,
    places: data.places.length,
    activityTemplates: data.activityTemplates.length,
    itineraryItems: data.items.length,
    expenses: data.expenses.length,
    stamps: data.stamps.length,
    rateSets: data.rateSets.length,
  }
  return {
    destination: data.trip.destination,
    records: Object.values(counts).reduce((sum, count) => sum + count, 1),
    photos: data.photos.length,
    photoBytes: data.photos.reduce((sum, photo) => sum + photo.size, 0),
    counts,
  }
}

export function cloudImportPayload(data: AppData, tripId: string, photoPaths: Record<string, string>) {
  return {
    schema_version: 4,
    trip_id: tripId,
    trip: data.trip,
    checklist: data.checklist,
    days: data.days,
    places: data.places,
    activity_templates: data.activityTemplates,
    itinerary_items: data.items,
    expenses: data.expenses,
    stamps: data.stamps,
    photos: data.photos.map(({ blob: _blob, ...photo }) => ({ ...photo, storagePath: photoPaths[photo.id] })),
    rate_sets: data.rateSets,
    metadata: data.metadata,
  }
}

export async function importNotebook(data: AppData, batchId: string, client: SupabaseClient = getCloudClient()) {
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Sign in before importing a notebook.')

  const { data: tripId, error: beginError } = await client.rpc('begin_notebook_import', {
    import_batch_id:batchId,
    destination:data.trip.destination,
  })
  if (beginError) throw beginError
  if (typeof tripId !== 'string') throw new Error('The server did not prepare the import.')

  const photoPaths: Record<string, string> = {}
  for (const photo of data.photos) {
    const path = `${tripId}/${photo.id}.${extensionFor(photo)}`
    const { error } = await client.storage.from('trip-photos').upload(path, photo.blob, {
      contentType: photo.mimeType,
      upsert: false,
    })
    if (error) {
      if (!/already exists/i.test(error.message)) throw error
      const { data: existing, error: downloadError } = await client.storage.from('trip-photos').download(path)
      if (downloadError) throw downloadError
      if (existing.size !== photo.blob.size || await sha256(existing) !== await sha256(photo.blob)) {
        throw new Error(`Existing photo "${photo.id}" does not match this import.`)
      }
    }
    photoPaths[photo.id] = path
  }

  const { data: importedTripId, error } = await client.rpc('import_notebook_v4', {
    import_batch_id: batchId,
    notebook: cloudImportPayload(data, tripId, photoPaths),
  })
  if (error) throw error
  if (typeof importedTripId !== 'string') throw new Error('The server did not acknowledge the imported trip.')
  return importedTripId
}
