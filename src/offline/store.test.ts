import { Blob as NativeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotebookStore } from '../notebookStore'
import type { DownloadedTrip } from './downloads'
import { DownloadedNotebookStore } from './store'
import { metadataFixture } from './test-fixtures'

beforeEach(() => { vi.stubGlobal('Blob', NativeBlob) })
afterEach(() => { vi.unstubAllGlobals() })

function snapshot(): DownloadedTrip {
  const raw = metadataFixture()
  return {
    schemaVersion: 1, userId: 'user-a', tripId: 'trip-a', savedAt: new Date().toISOString(),
    notebook: { ...raw, photos: raw.photos.map(photo => ({ ...photo, blob: new Blob(['test'], { type: 'image/jpeg' }) })) },
  }
}

describe('DownloadedNotebookStore', () => {
  it('is read-only and clones inputs and every loaded result including nested optional fields', async () => {
    const copy = snapshot()
    const original = structuredClone(copy.notebook)
    const store = new DownloadedNotebookStore(copy)
    expect(store.kind).toBe('download')
    expect(store.readOnly).toBe(true)
    expect(store.tripId).toBe('trip-a')
    await store.initialize()
    copy.notebook.trip.notes = 'Changed by caller'
    const first = await store.load()
    expect(first).toEqual(original)
    first.activityTemplates[0].stops[0].notes.push('Changed by consumer')
    first.photos[0].caption = 'Changed caption'
    expect(await store.load()).toEqual(original)
    expect(await (await store.load()).photos[0].blob.text()).toBe('test')
  })

  it('rejects every mutation with no state changes or queued operations', async () => {
    const copy = snapshot()
    const data = copy.notebook
    const store: NotebookStore = new DownloadedNotebookStore(copy)
    const mutations: Record<Exclude<keyof NotebookStore, 'kind' | 'readOnly' | 'tripId' | 'initialize' | 'load'>, () => unknown> = {
      createItineraryPlace: () => store.createItineraryPlace(data.places[0], data.items[0]),
      scheduleCandidatePlace: () => store.scheduleCandidatePlace('place-a', 'day-a'),
      saveItineraryDetails: () => store.saveItineraryDetails('item-a', {}, undefined),
      deleteItineraryItem: () => store.deleteItineraryItem('item-a'),
      deleteItineraryGroup: () => store.deleteItineraryGroup('group-a'),
      materializeTemplate: () => store.materializeTemplate(data.activityTemplates[0], 'day-a'),
      createStamp: () => store.createStamp(data.stamps[0], 'item-a'),
      undoStamp: () => store.undoStamp('stamp-a', 'item-a'),
      savePhoto: () => store.savePhoto(data.photos[0]),
      deletePhoto: () => store.deletePhoto(data.photos[0]),
      deleteDetachedMemory: () => store.deleteDetachedMemory('stamp-a'),
      saveChecklist: () => store.saveChecklist(data.checklist[0]),
      setChecklistCompleted: () => store.setChecklistCompleted('check-a', false, new Date().toISOString()),
      deleteChecklist: () => store.deleteChecklist('check-a'),
      addPlace: () => store.addPlace(data.places[0]),
      updatePlace: () => store.updatePlace('place-a', { updatedAt: new Date().toISOString() }),
      deletePlace: () => store.deletePlace('place-a'),
      updateTemplate: () => store.updateTemplate('template-a', data.activityTemplates[0]),
      deleteTemplate: () => store.deleteTemplate('template-a'),
      saveExpense: () => store.saveExpense(data.expenses[0]),
      deleteExpense: () => store.deleteExpense('expense-a'),
      setDisplayCurrency: () => store.setDisplayCurrency('USD'),
      activateRateSet: () => store.activateRateSet(data.rateSets[0]),
      replaceAll: () => store.replaceAll(data),
    }
    for (const mutation of Object.values(mutations)) {
      await expect(mutation()).rejects.toThrow('Downloaded trip is read-only')
    }
    expect(await store.load()).toEqual(data)
    expect(copy.notebook).toEqual(data)
  })
})
