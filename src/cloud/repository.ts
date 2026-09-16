import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppData, PhotoEntry } from '../types'
import { getCloudClient } from './client'

export interface CloudTripSummary {
  id: string
  destination: string
  role: 'owner' | 'editor'
  updatedAt: string
}

export async function listCloudTrips(client: SupabaseClient = getCloudClient()): Promise<CloudTripSummary[]> {
  const { data, error } = await client.rpc('list_notebook_trips')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('The server returned invalid trip data.')
  return data.map(row => ({
    id:String(row.id),
    destination:String(row.destination),
    role:row.role === 'owner' ? 'owner' : 'editor',
    updatedAt:String(row.updated_at),
  }))
}

export async function loadCloudNotebook(tripId: string, client: SupabaseClient = getCloudClient()): Promise<AppData> {
  const { data, error } = await client.rpc('load_notebook_v4', { p_trip_id:tripId })
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('The server returned an invalid notebook.')
  const notebook = data as Omit<AppData, 'photos'> & { photos:Array<Omit<PhotoEntry, 'blob'>> }
  if (!Array.isArray(notebook.photos)) throw new Error('The server returned invalid photo metadata.')
  const photos: PhotoEntry[] = []
  for (const photo of notebook.photos) {
    const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
    const { data: blob, error: photoError } = await client.storage.from('trip-photos').download(`${tripId}/${photo.id}.${extension}`)
    if (photoError) throw photoError
    if (blob.size !== photo.size) throw new Error(`Photo "${photo.id}" has the wrong size.`)
    photos.push({ ...photo, blob })
  }
  return { ...notebook, photos }
}
