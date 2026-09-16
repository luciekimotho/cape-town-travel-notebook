import {
  createItineraryPlace,
  db,
  deleteItineraryGroup,
  deleteItineraryItem,
  initializeDatabase,
  loadData,
  materializeTemplate,
  replaceAll,
  saveItineraryDetails,
  scheduleCandidatePlace,
  type ItineraryDetailsPatch,
  type LinkedCostInput,
} from './db'
import type {
  ActivityTemplate,
  AppData,
  ChecklistItem,
  Currency,
  Expense,
  ItineraryItem,
  PhotoEntry,
  Place,
  RateSet,
  TravelStamp,
} from './types'

export interface PlacePatch {
  name?: string
  address?: string
  googleMapsUrl?: string
  notes?: string
}

export interface ScheduledItemPatch {
  parentId?: string
  time?: string
  bookingStatus?: ItineraryItem['bookingStatus']
  notes?: string
}

export interface MaterializeDetails extends PlacePatch, ScheduledItemPatch {}

export interface StoreWriteResult {
  notebook: AppData
  warning?: string
}

export type StoreWrite = Promise<void | AppData | StoreWriteResult>

export interface NotebookStore {
  readonly kind: 'local' | 'cloud'
  readonly tripId?: string
  initialize(): Promise<void>
  load(): Promise<AppData>
  createItineraryPlace(place: Place, item: ItineraryItem, cost?: LinkedCostInput): StoreWrite
  scheduleCandidatePlace(placeId: string, dayId: string, cost?: LinkedCostInput, placePatch?: PlacePatch, itemPatch?: ScheduledItemPatch): StoreWrite
  saveItineraryDetails(itemId: string, patch: ItineraryDetailsPatch, linkedCost: LinkedCostInput | null | undefined): StoreWrite
  deleteItineraryItem(itemId: string): StoreWrite
  deleteItineraryGroup(parentId: string): StoreWrite
  materializeTemplate(template: ActivityTemplate, dayId: string, cost?: LinkedCostInput, details?: MaterializeDetails): StoreWrite
  createStamp(stamp: TravelStamp, itemId: string): StoreWrite
  undoStamp(stampId: string, itemId: string): StoreWrite
  savePhoto(photo: PhotoEntry): StoreWrite
  deletePhoto(photo: PhotoEntry): StoreWrite
  deleteDetachedMemory(stampId: string): StoreWrite
  saveChecklist(item: ChecklistItem): StoreWrite
  setChecklistCompleted(itemId: string, completed: boolean, updatedAt: string): StoreWrite
  deleteChecklist(itemId: string): StoreWrite
  addPlace(place: Place): StoreWrite
  updatePlace(placeId: string, patch: PlacePatch & { updatedAt: string }): StoreWrite
  deletePlace(placeId: string): StoreWrite
  updateTemplate(templateId: string, patch: Pick<ActivityTemplate, 'name' | 'description' | 'updatedAt'>): StoreWrite
  deleteTemplate(templateId: string): StoreWrite
  saveExpense(expense: Expense): StoreWrite
  deleteExpense(expenseId: string): StoreWrite
  setDisplayCurrency(currency: Currency): StoreWrite
  activateRateSet(rateSet: RateSet): StoreWrite
  replaceAll(data: AppData): StoreWrite
}

export const localNotebookStore: NotebookStore = {
  kind:'local',
  initialize:initializeDatabase,
  load:loadData,
  async createItineraryPlace(place, item, cost) { await createItineraryPlace(place, item, cost) },
  async scheduleCandidatePlace(placeId, dayId, cost, placePatch, itemPatch) { await scheduleCandidatePlace(placeId, dayId, cost, placePatch, itemPatch) },
  saveItineraryDetails,
  deleteItineraryItem,
  deleteItineraryGroup,
  async materializeTemplate(template, dayId, cost, details) { await materializeTemplate(template, dayId, cost, details) },
  async createStamp(stamp, itemId) {
    await db.transaction('rw', [db.items, db.stamps], async () => {
      await db.stamps.add(stamp)
      await db.items.update(itemId, { visited:true, updatedAt:new Date().toISOString() })
    })
  },
  async undoStamp(stampId, itemId) {
    await db.transaction('rw', [db.items, db.stamps, db.photos], async () => {
      await db.photos.where('stampId').equals(stampId).delete()
      await db.stamps.delete(stampId)
      await db.items.update(itemId, { visited:false, updatedAt:new Date().toISOString() })
    })
  },
  async savePhoto(photo) { await db.photos.put(photo) },
  async deletePhoto(photo) { await db.photos.delete(photo.id) },
  async deleteDetachedMemory(stampId) {
    await db.transaction('rw', [db.stamps, db.photos], async () => {
      await db.photos.where('stampId').equals(stampId).delete()
      await db.stamps.delete(stampId)
    })
  },
  async saveChecklist(item) { await db.checklist.put(item) },
  async setChecklistCompleted(itemId, completed, updatedAt) { await db.checklist.update(itemId, { completed, updatedAt }) },
  async deleteChecklist(itemId) { await db.checklist.delete(itemId) },
  async addPlace(place) { await db.places.add(place) },
  async updatePlace(placeId, patch) { await db.places.update(placeId, patch) },
  async deletePlace(placeId) {
    await db.transaction('rw', [db.places, db.items], async () => {
      if (await db.items.where('placeId').equals(placeId).count()) {
        throw new Error('Remove this place from the itinerary before deleting it.')
      }
      await db.places.delete(placeId)
    })
  },
  async updateTemplate(templateId, patch) { await db.activityTemplates.update(templateId, patch) },
  async deleteTemplate(templateId) { await db.activityTemplates.delete(templateId) },
  async saveExpense(expense) { await db.expenses.put(expense) },
  async deleteExpense(expenseId) { await db.expenses.delete(expenseId) },
  async setDisplayCurrency(currency) { await db.metadata.put({ key:'displayCurrency', value:currency }) },
  async activateRateSet(rateSet) {
    await db.transaction('rw', db.rateSets, async () => {
      await db.rateSets.toCollection().modify({ active:false })
      await db.rateSets.add(rateSet)
    })
  },
  replaceAll,
}
