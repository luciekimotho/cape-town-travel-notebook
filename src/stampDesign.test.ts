import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { createItineraryPlace, db, deleteItineraryGroup, deleteItineraryItem, initializeDatabase, loadData, materializeTemplate, saveItineraryDetails, scheduleCandidatePlace } from './db'
import { localNotebookStore as store } from './notebookStore'
import { isStampDesign, stampKinds, type StampDesign } from './stampDesign'
import type { AppData, ItineraryItem, Place, TravelStamp } from './types'

const timestamp = '2026-09-17T00:00:00Z'
const place: Place = { id:'design-place', name:'Table Mountain', stampKind:'boat', wantToVisit:true, createdAt:timestamp, updatedAt:timestamp }
const item: ItineraryItem = { id:'design-item', dayId:'2026-09-21', placeId:place.id, visited:false, position:0, createdAt:timestamp, updatedAt:timestamp }
const memory: TravelStamp = { id:'design-stamp', itineraryItemId:item.id, placeName:'Original name', visitDate:'2026-09-21', stampKind:'wine', detached:false, createdAt:timestamp }

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeDatabase()
})

describe('stamp design persistence', () => {
  it('validates every supported design without accepting null or arbitrary strings', () => {
    expect(stampKinds).toHaveLength(12)
    for (const kind of [...stampKinds, 'auto']) expect(isStampDesign(kind)).toBe(true)
    for (const invalid of [undefined, null, '', 'default', 'Mountain', 3, {}]) expect(isStampDesign(invalid)).toBe(false)
  })

  it('snapshots persisted choices, updates live stamps, and preserves memory metadata', async () => {
    await createItineraryPlace(place, item)
    await store.createStamp(memory, item.id)
    expect(await db.stamps.get(memory.id)).toEqual({ ...memory, stampKind:'boat' })
    await store.updatePlace(place.id, { stampKind:'penguin', updatedAt:timestamp })
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('penguin')
    await saveItineraryDetails(item.id, { stampKind:'pin', name:'A new name', dayId:'2026-09-22' }, undefined)
    await store.updatePlace(place.id, { stampKind:'mountain', updatedAt:timestamp })
    expect(await db.stamps.get(memory.id)).toEqual({ ...memory, stampKind:'pin' })
    await saveItineraryDetails(item.id, { stampKind:'auto' }, undefined)
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('auto')
    await deleteItineraryItem(item.id)
    await store.updatePlace(place.id, { stampKind:'house', updatedAt:timestamp })
    expect(await db.stamps.get(memory.id)).toEqual({
      id:memory.id, placeName:memory.placeName, visitDate:memory.visitDate,
      createdAt:memory.createdAt, detached:true, stampKind:'auto',
    })
  })

  it('captures the place fallback when deleting a legacy live stamp', async () => {
    await createItineraryPlace(place, item)
    await db.stamps.add({ ...memory, stampKind:undefined })
    await deleteItineraryItem(item.id)
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('boat')
  })

  it('treats legacy omission as automatic and explicit pin as the neutral Default', async () => {
    await createItineraryPlace({ ...place, stampKind:undefined }, item)
    await store.createStamp(memory, item.id)
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('auto')
    await saveItineraryDetails(item.id, { stampKind:'pin' }, undefined)
    expect((await loadData()).items.find(row => row.id === item.id)?.stampKind).toBe('pin')
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('pin')
  })

  it('schedules wishlist designs and refreshes other live visits atomically', async () => {
    await createItineraryPlace(place, item)
    await store.createStamp(memory, item.id)
    const scheduled = await scheduleCandidatePlace(place.id, '2026-09-22', undefined,
      { stampKind:'cliff' }, { stampKind:'lighthouse' })
    expect(scheduled.stampKind).toBe('lighthouse')
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('cliff')
    await expect(scheduleCandidatePlace(place.id, '2026-09-22', { amount:-1, currency:'USD' },
      { stampKind:'wine' })).rejects.toThrow()
    expect((await db.places.get(place.id))?.stampKind).toBe('cliff')
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('cliff')
  })

  it('materializes template defaults only on the parent/single item, reusing child choices', async () => {
    const data = await loadData()
    const template = data.activityTemplates.find(row => row.stops.length > 1)!
    const childPlaceId = template.stops[0].placeId!
    await store.updatePlace(childPlaceId, { stampKind:'house', updatedAt:timestamp })
    await store.updateTemplate(template.id, { name:template.name, description:template.description, stampKind:'road', updatedAt:timestamp })
    const savedTemplate = (await db.activityTemplates.get(template.id))!
    const parent = await materializeTemplate(savedTemplate, item.dayId)
    expect(parent.stampKind).toBe('road')
    const child = (await db.items.where('parentId').equals(parent.id).toArray()).find(row => row.placeId === childPlaceId)!
    expect(child.stampKind).toBeUndefined()
    expect((await db.places.get(child.placeId))?.stampKind).toBe('house')
    await store.createStamp({ ...memory, id:'child-stamp' }, child.id)
    await store.createStamp({ ...memory, id:'parent-stamp' }, parent.id)
    await deleteItineraryGroup(parent.id)
    expect((await db.stamps.get('parent-stamp'))?.stampKind).toBe('road')
    expect((await db.stamps.get('child-stamp'))?.stampKind).toBe('house')
    const single = { ...savedTemplate, stops:[template.stops[0]] }
    const customized = await materializeTemplate(single, item.dayId, undefined, { name:'Custom stop', stampKind:'pin' })
    expect(customized.stampKind).toBe('pin')
    expect((await db.places.get(customized.placeId))?.stampKind).toBe('house')
  })

  it('round-trips all choices through schema4 ZIP and atomic restore, preserving detached snapshots', async () => {
    await createItineraryPlace(place, { ...item, stampKind:'pin' })
    await store.createStamp(memory, item.id)
    await db.stamps.add({ ...memory, id:'detached', itineraryItemId:undefined, stampKind:'auto', detached:true })
    const data = await loadData()
    data.activityTemplates[0].stampKind = 'road'
    const file = new File([await createBackup(data)], 'designs.zip')
    const zip = await JSZip.loadAsync(file)
    expect(JSON.parse(await zip.file('notebook.json')!.async('text')).schemaVersion).toBe(4)
    const parsed = await parseBackup(file)
    await restoreBackup(parsed)
    const restored = await loadData()
    for (const key of ['places', 'items', 'activityTemplates', 'stamps'] as const) {
      expect(restored[key]).toEqual(parsed[key])
    }
    const legacy = { ...parsed, places:parsed.places.map(({ stampKind: _kind, ...row }) => row) }
    expect((await parseBackup(new File([await createBackup(legacy)], 'legacy.zip'))).places.every(row => row.stampKind === undefined)).toBe(true)
  })

  it.each(['places', 'items', 'activityTemplates', 'stamps'] as const)('rejects invalid %s designs before restore or export', async key => {
    await createItineraryPlace(place, item)
    await store.createStamp(memory, item.id)
    const original = await loadData()
    for (const invalid of ['unknown', null, 12]) {
      const corrupt: AppData = { ...original, [key]:original[key].map((row, index) => index ? row : { ...row, stampKind:invalid }) }
      const zip = new JSZip()
      zip.file('notebook.json', JSON.stringify({ ...corrupt, schemaVersion:4 }))
      await expect(parseBackup(new File([await zip.generateAsync({ type:'blob' })], 'bad.zip'))).rejects.toThrow('stamp design')
      await expect(restoreBackup(corrupt)).rejects.toThrow('stamp design')
      await expect(createBackup(corrupt)).rejects.toThrow('stamp design')
      expect(await loadData()).toEqual(original)
    }
  })

  it('rejects invalid mutations and rolls back edits without changing the stamp', async () => {
    await createItineraryPlace(place, item)
    await store.createStamp(memory, item.id)
    const invalid = 'invalid' as StampDesign
    await expect(store.updatePlace(place.id, { stampKind:invalid, updatedAt:timestamp })).rejects.toThrow('stamp design')
    await expect(saveItineraryDetails(item.id, { stampKind:invalid }, undefined)).rejects.toThrow('stamp design')
    await expect(saveItineraryDetails(item.id, { stampKind:'pin' }, { amount:-10, currency:'USD' })).rejects.toThrow()
    expect((await db.items.get(item.id))?.stampKind).toBeUndefined()
    expect((await db.stamps.get(memory.id))?.stampKind).toBe('boat')
  })
})
