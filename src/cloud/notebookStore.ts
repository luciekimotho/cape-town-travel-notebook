import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotebookStore } from '../notebookStore'
import type { AppData, Expense, PhotoEntry } from '../types'
import { CloudNotebookRepository } from './repository'

const requireOnline = () => {
  if (!navigator.onLine) throw new Error('Cloud editing needs an internet connection. Nothing was saved.')
}

export class CloudNotebookStore implements NotebookStore {
  readonly kind = 'cloud' as const
  readonly tripId: string
  private readonly repository: CloudNotebookRepository
  private snapshot?: AppData

  constructor(tripId: string, client?: SupabaseClient) {
    this.tripId = tripId
    this.repository = new CloudNotebookRepository(tripId, client)
  }

  async initialize() {
    requireOnline()
  }

  async load() {
    requireOnline()
    this.snapshot = await this.repository.load()
    return this.snapshot
  }

  private async saved(operation: () => Promise<{ notebook?: AppData; cleanupWarning?: string }>) {
    requireOnline()
    const result = await operation()
    const notebook = result.notebook ?? this.snapshot
    if (!notebook) throw new Error('The change was saved, but the notebook must be reloaded before continuing.')
    this.snapshot = notebook
    return result.cleanupWarning
      ? { notebook, warning:result.cleanupWarning }
      : notebook
  }

  createItineraryPlace(place: Parameters<NotebookStore['createItineraryPlace']>[0], item: Parameters<NotebookStore['createItineraryPlace']>[1], cost?: Parameters<NotebookStore['createItineraryPlace']>[2]) {
    return this.saved(() => this.repository.createItinerary(place, item, cost))
  }

  scheduleCandidatePlace(placeId: string, dayId: string, cost?: Parameters<NotebookStore['scheduleCandidatePlace']>[2], placePatch?: Parameters<NotebookStore['scheduleCandidatePlace']>[3], itemPatch?: Parameters<NotebookStore['scheduleCandidatePlace']>[4]) {
    return this.saved(() => this.repository.scheduleWishlistPlace(placeId, dayId, cost, placePatch, itemPatch))
  }

  saveItineraryDetails(itemId: string, patch: Parameters<NotebookStore['saveItineraryDetails']>[1], linkedCost: Parameters<NotebookStore['saveItineraryDetails']>[2]) {
    return this.saved(() => this.repository.updateItinerary(itemId, patch, linkedCost))
  }

  deleteItineraryItem(itemId: string) {
    return this.saved(() => this.repository.deleteItineraryItem(itemId))
  }

  deleteItineraryGroup(parentId: string) {
    return this.saved(() => this.repository.deleteItineraryGroup(parentId))
  }

  materializeTemplate(template: Parameters<NotebookStore['materializeTemplate']>[0], dayId: string, cost?: Parameters<NotebookStore['materializeTemplate']>[2], details?: Parameters<NotebookStore['materializeTemplate']>[3]) {
    return this.saved(() => this.repository.materializeActivityTemplate(template.id, dayId, cost, details))
  }

  createStamp(_stamp: Parameters<NotebookStore['createStamp']>[0], itemId: string) {
    return this.saved(() => this.repository.createStamp(itemId))
  }

  undoStamp(_stampId: string, itemId: string) {
    return this.saved(() => this.repository.undoStamp(itemId))
  }

  async savePhoto(photo: PhotoEntry) {
    const existing = this.snapshot?.photos.find(candidate => candidate.stampId === photo.stampId)
    if (!existing) {
      return this.saved(() => this.repository.addPhoto({
        id:photo.id,
        stampId:photo.stampId,
        caption:photo.caption,
        mimeType:photo.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        width:photo.width,
        height:photo.height,
        blob:photo.blob,
      }))
    }
    if (existing.blob === photo.blob) {
      return this.saved(() => this.repository.updatePhotoCaption(existing.id, photo.caption))
    }
    const replacement = {
      id:existing.id,
      stampId:photo.stampId,
      caption:photo.caption,
      mimeType:photo.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
      width:photo.width,
      height:photo.height,
      blob:photo.blob,
    }
    return this.saved(() => this.repository.replacePhoto(existing, replacement))
  }

  deletePhoto(photo: PhotoEntry) {
    return this.saved(() => this.repository.deletePhoto(photo))
  }

  deleteDetachedMemory(stampId: string) {
    return this.saved(() => this.repository.deleteDetachedMemory(stampId))
  }

  saveChecklist(item: Parameters<NotebookStore['saveChecklist']>[0]) {
    const exists = this.snapshot?.checklist.some(candidate => candidate.id === item.id)
    return this.saved(() => exists
      ? this.repository.updateChecklist(item.id, {
          title:item.title,
          category:item.category,
          dueDate:item.dueDate,
          note:item.note,
          completed:item.completed,
        })
      : this.repository.createChecklist(item))
  }

  setChecklistCompleted(itemId: string, completed: boolean) {
    return this.saved(() => this.repository.updateChecklist(itemId, { completed }))
  }

  deleteChecklist(itemId: string) {
    return this.saved(() => this.repository.deleteChecklist(itemId))
  }

  addPlace(place: Parameters<NotebookStore['addPlace']>[0]) {
    return this.saved(() => this.repository.createWishlistPlace(place))
  }

  updatePlace(placeId: string, patch: Parameters<NotebookStore['updatePlace']>[1]) {
    return this.saved(() => this.repository.updatePlace(placeId, patch))
  }

  deletePlace(placeId: string) {
    return this.saved(() => this.repository.deletePlace(placeId))
  }

  updateTemplate(templateId: string, patch: Parameters<NotebookStore['updateTemplate']>[1]) {
    return this.saved(() => this.repository.updateActivityTemplate(templateId, patch))
  }

  deleteTemplate(templateId: string) {
    return this.saved(() => this.repository.deleteActivityTemplate(templateId))
  }

  saveExpense(expense: Expense) {
    const exists = this.snapshot?.expenses.some(candidate => candidate.id === expense.id)
    return this.saved(() => exists
      ? this.repository.updateExpense(expense.id, {
          amount:expense.amount,
          currency:expense.currency,
          date:expense.date,
          category:expense.category,
          note:expense.note,
        })
      : this.repository.createExpense(expense))
  }

  deleteExpense(expenseId: string) {
    return this.saved(() => this.repository.deleteExpense(expenseId))
  }

  setDisplayCurrency(currency: Parameters<NotebookStore['setDisplayCurrency']>[0]) {
    return this.saved(() => this.repository.setDisplayCurrency(currency))
  }

  activateRateSet(rateSet: Parameters<NotebookStore['activateRateSet']>[0]) {
    return this.saved(() => this.repository.activateRates(rateSet))
  }

  replaceAll(data: AppData) {
    return this.saved(() => this.repository.restoreNotebook(data))
  }
}
