import { beforeEach, describe, expect, it } from 'vitest'
import { db, datesBetween, deleteItineraryGroup, initializeDatabase, loadData, materializeTemplate, saveTrip } from './db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('Phase 1 persistence', () => {
  it('creates date-only trip days without timezone shifts', () => {
    expect(datesBetween('2026-09-21', '2026-09-28')).toEqual([
      '2026-09-21','2026-09-22','2026-09-23','2026-09-24',
      '2026-09-25','2026-09-26','2026-09-27','2026-09-28',
    ])
  })

  it('seeds editable trip data and persists records', async () => {
    await initializeDatabase()
    const initial = await loadData()
    expect(initial.trip.destination).toBe('Cape Town, South Africa')
    expect(initial.days).toHaveLength(8)
    expect(initial.places.filter(place => place.seeded)).toHaveLength(14)
    expect(initial.places.every(place => !place.wantToVisit)).toBe(true)
    expect(initial.activityTemplates.map(template => template.name)).toEqual(expect.arrayContaining([
      'Cape Town Red Bus / Hop-On Hop-Off', 'Table Mountain', 'Cape Peninsula Tour',
    ]))
    expect(initial.activityTemplates.find(template => template.name === 'Cape Peninsula Tour')?.stops).toHaveLength(9)
    await db.checklist.update(initial.checklist[0].id, { completed: true })
    expect((await loadData()).checklist.find(item => item.id === initial.checklist[0].id)?.completed).toBe(true)
  })

  it('keeps planning seeds idempotent and unscheduled', async () => {
    await initializeDatabase()
    await initializeDatabase()
    const data = await loadData()
    expect(data.places.filter(place => place.seeded)).toHaveLength(14)
    expect(data.activityTemplates).toHaveLength(3)
    expect(data.items).toHaveLength(0)
    expect(data.activityTemplates.flatMap(template => template.stops).every(stop => stop.approximateMinutes === undefined || stop.approximateMinutes > 0)).toBe(true)
  })

  it('initializes safely when React Strict Mode starts twice', async () => {
    await Promise.all([initializeDatabase(), initializeDatabase()])
    const data = await loadData()
    expect(data.trip.id).toBe('current')
    expect(data.places.filter(place => place.seeded)).toHaveLength(14)
    expect(data.activityTemplates).toHaveLength(3)
  })

  it('materializes a multi-stop tour as one parent with visitable child stops', async () => {
    await initializeDatabase()
    const data = await loadData()
    const template = data.activityTemplates.find(item => item.name === 'Cape Peninsula Tour')!
    await materializeTemplate(template, '2026-09-24')
    const scheduled = (await loadData()).items.filter(item => item.dayId === '2026-09-24')
    const parent = scheduled.find(item => item.isActivityGroup)
    expect(parent?.templateId).toBe(template.id)
    expect(scheduled.filter(item => item.parentId === parent?.id)).toHaveLength(9)
    expect(scheduled.filter(item => !item.parentId)).toHaveLength(1)
  })

  it('preserves visited child stamps as detached memories when a tour is deleted', async () => {
    await initializeDatabase()
    const data = await loadData()
    const template = data.activityTemplates.find(item => item.name === 'Cape Peninsula Tour')!
    await materializeTemplate(template, '2026-09-24')
    const scheduled = (await loadData()).items.filter(item => item.dayId === '2026-09-24')
    const parent = scheduled.find(item => item.isActivityGroup)!
    const child = scheduled.find(item => item.parentId === parent.id)!
    await db.stamps.add({ id: 'tour-stamp', itineraryItemId: child.id, placeName: 'Bo-Kaap', visitDate: '2026-09-24', detached: false, createdAt: new Date().toISOString() })
    await deleteItineraryGroup(parent.id)
    expect(await db.items.where('parentId').equals(parent.id).count()).toBe(0)
    expect(await db.items.get(parent.id)).toBeUndefined()
    const detached = await db.stamps.get('tour-stamp')
    expect(detached).toMatchObject({ detached: true })
    expect(detached).not.toHaveProperty('itineraryItemId')
  })

  it('preserves and flags days when trip dates are shortened', async () => {
    await initializeDatabase()
    const data = await loadData()
    await saveTrip({ ...data.trip, endDate: '2026-09-25' })
    const changed = await loadData()
    expect(changed.days).toHaveLength(8)
    expect(changed.days.find(day => day.date === '2026-09-28')?.outOfRange).toBe(true)
  })
})
