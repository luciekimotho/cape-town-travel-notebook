import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActivityTemplate, AppData, ChecklistItem, Currency, Expense, ItineraryItem, PhotoEntry, Place, RateSet, Trip,
} from '../types'
import { getCloudClient } from './client'

export interface CloudTripSummary {
  id: string
  destination: string
  role: 'owner' | 'editor'
  updatedAt: string
}

export interface MutationAcknowledgement {
  ok: true
  operation: string
  id?: string
  objectPath?: string
  objectPaths?: string[]
  counts?: Record<string, number>
}

export interface MutationResult {
  acknowledgement: MutationAcknowledgement
  notebook?: CloudAppData
  cleanupWarning?: string
}

export type RestoreResult = MutationResult

export interface LinkedCostInput {
  amount: number
  currency: Currency
  note?: string
}

export type ItineraryPatch = Partial<Pick<ItineraryItem,
  'dayId' | 'parentId' | 'time' | 'notes' | 'bookingStatus' | 'position'>> & {
  name?: string
  address?: string
  googleMapsUrl?: string
}

export interface PlacePatch extends Partial<Pick<Place,
  'name' | 'address' | 'notes' | 'googleMapsUrl' | 'wantToVisit'>> {}

export interface MaterializeDetails extends PlacePatch {
  parentId?: string
  time?: string
  bookingStatus?: ItineraryItem['bookingStatus']
}

export interface PhotoMetadataInput {
  id: string
  stampId: string
  caption: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
  blob: Blob
}

export interface CloudPhotoEntry extends PhotoEntry {
  storagePath: string
}

export type CloudAppData = Omit<AppData, 'photos'> & { photos: CloudPhotoEntry[] }

export interface CollaborationStatus {
  role: 'owner' | 'editor'
  pendingEmail: string | null
  claimedEmail: string | null
  claimedUserId: string | null
}

function photoMutationPayload(
  photo: Pick<PhotoEntry, 'id' | 'stampId' | 'caption' | 'mimeType' | 'width' | 'height' | 'blob'>,
  objectPath: string,
): Record<string, unknown> {
  return {
    id: photo.id,
    stampId: photo.stampId,
    caption: photo.caption,
    mimeType: photo.mimeType,
    width: photo.width,
    height: photo.height,
    size: photo.blob.size,
    objectPath,
  }
}

export async function listCloudTrips(client: SupabaseClient = getCloudClient()): Promise<CloudTripSummary[]> {
  const { data, error } = await client.rpc('list_notebook_trips')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('The server returned invalid trip data.')
  return data.map(row => ({
    id: String(row.id),
    destination: String(row.destination),
    role: row.role === 'owner' ? 'owner' : 'editor',
    updatedAt: String(row.updated_at),
  }))
}

export async function createFreshTrip(client: SupabaseClient = getCloudClient()): Promise<string> {
  const { data, error } = await client.rpc('create_capetown_2026_trip_v2')
  if (error) throw error
  if (typeof data !== 'string') throw new Error('The server did not create the trip.')
  return data
}

export async function loadCloudNotebook(tripId: string, client: SupabaseClient = getCloudClient()): Promise<CloudAppData> {
  const { data, error } = await client.rpc('load_notebook_v4', { p_trip_id: tripId })
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('The server returned an invalid notebook.')
  const notebook = data as Omit<AppData, 'photos'> & {
    photos: Array<Omit<PhotoEntry, 'blob'> & { storagePath?: string }>
  }
  if (!Array.isArray(notebook.photos)) throw new Error('The server returned invalid photo metadata.')
  const photos: CloudPhotoEntry[] = []
  for (const photo of notebook.photos) {
    const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
    const storagePath = photo.storagePath ?? `${tripId}/${photo.id}.${extension}`
    const { data: blob, error: photoError } = await client.storage.from('trip-photos').download(storagePath)
    if (photoError) throw photoError
    if (blob.size !== photo.size) throw new Error(`Photo "${photo.id}" has the wrong size.`)
    photos.push({ ...photo, storagePath, blob })
  }
  return { ...notebook, photos }
}

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class CloudNotebookRepository {
  readonly tripId: string
  private readonly client: SupabaseClient

  constructor(
    tripId: string,
    client: SupabaseClient = getCloudClient(),
  ) {
    if (!tripId) throw new Error('A trip ID is required.')
    this.tripId = tripId
    this.client = client
  }

  load() { return loadCloudNotebook(this.tripId, this.client) }

  private async reloadAcknowledged(acknowledgement: MutationAcknowledgement, cleanupWarning?: string): Promise<MutationResult> {
    try {
      return { acknowledgement, notebook:await this.load(), cleanupWarning }
    } catch {
      const refreshWarning = 'The change was saved, but the latest notebook could not be reloaded. Reconnect or refresh before editing again.'
      return { acknowledgement, cleanupWarning:cleanupWarning ? `${cleanupWarning} ${refreshWarning}` : refreshWarning }
    }
  }

  private async write(operation: string, payload: Record<string, unknown> = {}): Promise<MutationResult> {
    const { data, error } = await this.client.rpc('mutate_notebook_v1', {
      p_trip_id: this.tripId,
      p_operation: operation,
      p_payload: clean(payload),
    })
    if (error) throw error
    if (!data || data.ok !== true || data.operation !== operation) {
      throw new Error('The server did not acknowledge the notebook change.')
    }
    return this.reloadAcknowledged(data as MutationAcknowledgement)
  }

  updateTrip(patch: Partial<Omit<Trip, 'id' | 'updatedAt'>>) {
    return this.write('trip.update', { patch })
  }

  createChecklist(item: ChecklistItem) { return this.write('checklist.create', { item }) }
  updateChecklist(id: string, patch: Partial<Pick<ChecklistItem, 'title' | 'category' | 'dueDate' | 'note' | 'completed'>>) {
    return this.write('checklist.update', { id, patch })
  }
  toggleChecklist(id: string) { return this.write('checklist.toggle', { id }) }
  deleteChecklist(id: string) { return this.write('checklist.delete', { id }) }

  createWishlistPlace(place: Place) { return this.write('place.create', { place: { ...place, wantToVisit: true } }) }
  updatePlace(id: string, patch: PlacePatch) { return this.write('place.update', { id, patch }) }
  deletePlace(id: string) { return this.write('place.delete', { id }) }
  scheduleWishlistPlace(placeId: string, dayId: string, cost?: LinkedCostInput, placePatch?: PlacePatch,
    itemPatch?: Partial<Pick<ItineraryItem, 'parentId' | 'time' | 'bookingStatus' | 'notes'>>) {
    return this.write('place.schedule', { placeId, dayId, cost, placePatch, itemPatch })
  }

  updateActivityTemplate(id: string, patch: Partial<Pick<ActivityTemplate, 'name' | 'description' | 'stops'>>) {
    return this.write('template.update', { id, patch })
  }
  deleteActivityTemplate(id: string) { return this.write('template.delete', { id }) }
  materializeActivityTemplate(templateId: string, dayId: string, cost?: LinkedCostInput, details?: MaterializeDetails) {
    return this.write('template.materialize', { templateId, dayId, cost, details })
  }

  createItinerary(place: Place, item: ItineraryItem, cost?: LinkedCostInput) {
    return this.write('itinerary.create', { place, item, cost })
  }
  updateItinerary(id: string, patch: ItineraryPatch, linkedCost?: LinkedCostInput | null) {
    return this.write('itinerary.update', { id, patch, linkedCost })
  }
  moveItineraryGroup(id: string, dayId: string) { return this.write('itinerary.update', { id, patch: { dayId } }) }
  deleteItineraryItem(id: string) { return this.write('itinerary.delete', { id }) }
  deleteItineraryGroup(id: string) { return this.write('itinerary.delete_group', { id }) }

  createStamp(itemId: string) { return this.write('stamp.create', { itemId }) }
  async undoStamp(itemId: string) {
    const result = await this.write('stamp.undo', { itemId })
    return this.removeAcknowledgedObjects(result)
  }
  async deleteDetachedMemory(stampId: string) {
    const result = await this.write('stamp.delete_detached', { stampId })
    return this.removeAcknowledgedObjects(result)
  }

  createExpense(expense: Expense) { return this.write('expense.create', { expense }) }
  updateExpense(id: string, patch: Partial<Pick<Expense, 'amount' | 'currency' | 'date' | 'category' | 'note'>>) {
    return this.write('expense.update', { id, patch })
  }
  deleteExpense(id: string) { return this.write('expense.delete', { id }) }

  setDisplayCurrency(currency: Currency) { return this.write('metadata.display_currency', { currency }) }
  activateRates(rate: Pick<RateSet, 'id' | 'label' | 'effectiveDate' | 'kesPerUsd' | 'kesPerZar'>) {
    return this.write('rates.activate', { rate })
  }

  async addPhoto(photo: PhotoMetadataInput): Promise<MutationResult> {
    const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
    const objectPath = `${this.tripId}/${photo.id}-${crypto.randomUUID()}.${extension}`
    const bucket = this.client.storage.from('trip-photos')
    const upload = await bucket.upload(objectPath, photo.blob, { contentType: photo.mimeType, upsert: false })
    if (upload.error) throw upload.error
    try {
      return await this.write('photo.create', {
        photo: photoMutationPayload(photo, objectPath),
      })
    } catch (error) {
      await bucket.remove([objectPath])
      throw error
    }
  }

  async replacePhoto(
    oldPhoto: Pick<PhotoEntry, 'id'>,
    newPhoto: PhotoMetadataInput,
  ): Promise<MutationResult> {
    if (oldPhoto.id !== newPhoto.id) throw new Error('A replacement photo must preserve its logical photo ID.')
    const newExtension = newPhoto.mimeType === 'image/png' ? 'png' : newPhoto.mimeType === 'image/webp' ? 'webp' : 'jpg'
    const newObjectPath = `${this.tripId}/${newPhoto.id}-${crypto.randomUUID()}.${newExtension}`
    const bucket = this.client.storage.from('trip-photos')
    const upload = await bucket.upload(newObjectPath, newPhoto.blob, {
      contentType: newPhoto.mimeType,
      upsert: false,
    })
    if (upload.error) throw upload.error
    let result: MutationResult
    try {
      result = await this.write('photo.replace', {
        oldId: oldPhoto.id,
        photo: photoMutationPayload(newPhoto, newObjectPath),
      })
    } catch (error) {
      await bucket.remove([newObjectPath])
      throw error
    }
    const oldObjectPath = result.acknowledgement.objectPath
    if (!oldObjectPath) throw new Error('The server did not acknowledge the replaced photo path.')
    const removal = await bucket.remove([oldObjectPath])
    const warning = removal.error ? 'Photo saved, but the previous private photo object could not be removed.' : result.cleanupWarning
    return { ...result, cleanupWarning:warning }
  }

  async deletePhoto(photo: Pick<PhotoEntry, 'id'> & { storagePath?: string; mimeType?: string }): Promise<MutationResult> {
    const result = await this.write('photo.delete', { id: photo.id })
    const objectPath = result.acknowledgement.objectPath
    if (!objectPath) return { ...result, cleanupWarning:'Photo deleted, but the server did not return its private Storage path for cleanup.' }
    const removal = await this.client.storage.from('trip-photos').remove([objectPath])
    const warning = removal.error ? 'Photo deleted, but its old private Storage object could not be removed.' : result.cleanupWarning
    return { ...result, cleanupWarning:warning }
  }

  updatePhotoCaption(id: string, caption: string) {
    return this.write('photo.update', { id, caption })
  }

  private async removeAcknowledgedObjects(result: MutationResult): Promise<MutationResult> {
    const paths = result.acknowledgement.objectPaths ?? []
    if (!paths.length) return result
    const removal = await this.client.storage.from('trip-photos').remove(paths)
    const warning = removal.error ? 'The notebook was updated, but old private photo objects could not be removed.' : result.cleanupWarning
    return { ...result, cleanupWarning:warning }
  }

  async collaborationStatus(): Promise<CollaborationStatus> {
    const { data, error } = await this.client.rpc('trip_collaboration_status', { p_trip_id: this.tripId })
    if (error) throw error
    if (!data || typeof data !== 'object') throw new Error('The server returned invalid collaboration status.')
    return {
      role: data.role === 'owner' ? 'owner' : 'editor',
      pendingEmail: data.pending_email ?? null,
      claimedEmail: data.claimed_email ?? null,
      claimedUserId: data.claimed_user_id ?? null,
    }
  }

  removeClaimedEditor(userId: string) { return this.write('collaboration.remove_editor', { userId }) }
  shareWithEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) throw new Error('The second traveller’s email is required.')
    return this.write('collaboration.share', { email: normalizedEmail })
  }
  revokePendingShare() { return this.write('collaboration.revoke_pending') }

  async restoreNotebook(data: AppData): Promise<RestoreResult> {
    const bucket = this.client.storage.from('trip-photos')
    const uploadedPaths: string[] = []
    const photos: Record<string, unknown>[] = []
    let committed = false
    const cleanUploaded = async () => {
      if (!uploadedPaths.length) return null
      const removal = await bucket.remove(uploadedPaths)
      return removal.error
    }
    try {
      for (const photo of data.photos) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mimeType)) {
          throw new Error(`Photo "${photo.id}" has an unsupported MIME type.`)
        }
        const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
        const storagePath = `${this.tripId}/${photo.id}-${crypto.randomUUID()}.${extension}`
        const upload = await bucket.upload(storagePath, photo.blob, {
          contentType: photo.mimeType,
          upsert: false,
        })
        if (upload.error) throw upload.error
        uploadedPaths.push(storagePath)
        const { objectPath: _objectPath, ...metadata } = photoMutationPayload(photo, storagePath)
        photos.push({ ...metadata, storagePath })
      }
      const payload = clean({ schemaVersion: 4, ...data, photos })
      const { data: acknowledgement, error } = await this.client.rpc('restore_notebook_v1', {
        p_trip_id: this.tripId,
        p_payload: payload,
      })
      if (error) throw error
      if (!acknowledgement || acknowledgement.ok !== true || acknowledgement.operation !== 'notebook.restore') {
        throw new Error('The server did not acknowledge the notebook restore.')
      }
      committed = true
      let cleanupWarning: string | undefined
      const oldPaths = Array.isArray(acknowledgement.objectPaths)
        ? acknowledgement.objectPaths.filter((path: unknown): path is string => typeof path === 'string')
        : []
      if (oldPaths.length) {
        const removal = await bucket.remove(oldPaths)
        if (removal.error) {
          cleanupWarning = `Restore committed, but ${oldPaths.length} old photo object(s) could not be removed. Retry Storage cleanup.`
        }
      }
      return this.reloadAcknowledged(acknowledgement as MutationAcknowledgement, cleanupWarning)
    } catch (error) {
      const cleanupError = !committed ? await cleanUploaded() : null
      if (cleanupError) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`${reason} Newly uploaded photo cleanup also failed; manual private Storage cleanup is required.`)
      }
      throw error
    }
  }
}
