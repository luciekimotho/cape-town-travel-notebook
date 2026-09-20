import type { NotebookStore } from '../notebookStore'
import type { AppData } from '../types'
import type { DownloadedTrip } from './downloads'
import { validateDownloadedNotebook } from './validation'

export class DownloadedNotebookStore implements NotebookStore {
  readonly kind = 'download'
  readonly readOnly = true
  readonly tripId: string
  private readonly notebook: AppData

  constructor(snapshot: DownloadedTrip) {
    validateDownloadedNotebook(snapshot.notebook, snapshot.tripId)
    this.tripId = snapshot.tripId
    this.notebook = structuredClone(snapshot.notebook)
  }

  async initialize(): Promise<void> {}
  async load(): Promise<AppData> { return structuredClone(this.notebook) }

  private async rejectWrite(): Promise<never> {
    throw new Error('Downloaded trip is read-only. Reconnect to edit the live notebook.')
  }

  createItineraryPlace: NotebookStore['createItineraryPlace'] = () => this.rejectWrite()
  scheduleCandidatePlace: NotebookStore['scheduleCandidatePlace'] = () => this.rejectWrite()
  saveItineraryDetails: NotebookStore['saveItineraryDetails'] = () => this.rejectWrite()
  deleteItineraryItem: NotebookStore['deleteItineraryItem'] = () => this.rejectWrite()
  deleteItineraryGroup: NotebookStore['deleteItineraryGroup'] = () => this.rejectWrite()
  materializeTemplate: NotebookStore['materializeTemplate'] = () => this.rejectWrite()
  createStamp: NotebookStore['createStamp'] = () => this.rejectWrite()
  undoStamp: NotebookStore['undoStamp'] = () => this.rejectWrite()
  savePhoto: NotebookStore['savePhoto'] = () => this.rejectWrite()
  deletePhoto: NotebookStore['deletePhoto'] = () => this.rejectWrite()
  deleteDetachedMemory: NotebookStore['deleteDetachedMemory'] = () => this.rejectWrite()
  saveChecklist: NotebookStore['saveChecklist'] = () => this.rejectWrite()
  setChecklistCompleted: NotebookStore['setChecklistCompleted'] = () => this.rejectWrite()
  deleteChecklist: NotebookStore['deleteChecklist'] = () => this.rejectWrite()
  addPlace: NotebookStore['addPlace'] = () => this.rejectWrite()
  updatePlace: NotebookStore['updatePlace'] = () => this.rejectWrite()
  deletePlace: NotebookStore['deletePlace'] = () => this.rejectWrite()
  updateTemplate: NotebookStore['updateTemplate'] = () => this.rejectWrite()
  deleteTemplate: NotebookStore['deleteTemplate'] = () => this.rejectWrite()
  saveExpense: NotebookStore['saveExpense'] = () => this.rejectWrite()
  deleteExpense: NotebookStore['deleteExpense'] = () => this.rejectWrite()
  setDisplayCurrency: NotebookStore['setDisplayCurrency'] = () => this.rejectWrite()
  activateRateSet: NotebookStore['activateRateSet'] = () => this.rejectWrite()
  replaceAll: NotebookStore['replaceAll'] = () => this.rejectWrite()
}
