import { beforeEach, describe, expect, it } from 'vitest'
import { createItineraryPlace, db, datesBetween, deleteItineraryGroup, deleteItineraryItem, initializeDatabase, loadData, materializeTemplate, saveItineraryDetails, saveTrip, scheduleCandidatePlace } from './db'
import type { ItineraryItem, Place } from './types'

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
    expect(data.items.filter(item => !item.parentId)).toHaveLength(8)
    expect(data.items).toHaveLength(44)
    expect(data.checklist.filter(item => item.category === 'Shopping').map(item => item.title).sort()).toEqual(['Golf stuff',"Kids' clothes",'Sneakers'])
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
    const scheduled = (await loadData()).items.filter(item => item.dayId === '2026-09-24' && item.templateId === template.id)
    const parent = scheduled.find(item => item.isActivityGroup)
    expect(parent?.templateId).toBe(template.id)
    expect(scheduled.filter(item => item.parentId === parent?.id)).toHaveLength(9)
    expect(scheduled.filter(item => !item.parentId)).toHaveLength(1)
  })

  it('does not overwrite a shared place when customizing a single-stop template', async () => {
    await initializeDatabase()
    const sharedPlace = (await db.places.get('seed-place-table-mountain'))!
    const timestamp = new Date().toISOString()
    const template = {
      id:'single-stop-template', name:'Mountain visit', description:'', seeded:false,
      stops:[{ id:'single-stop', placeId:sharedPlace.id, placeName:sharedPlace.name, notes:[] }],
      createdAt:timestamp, updatedAt:timestamp,
    }
    const item = await materializeTemplate(template, '2026-09-22', undefined, {
      name:'Private cableway visit', address:'Custom meeting point', googleMapsUrl:'https://maps.example/custom',
    })
    expect(item.placeId).not.toBe(sharedPlace.id)
    expect(await db.places.get(sharedPlace.id)).toEqual(sharedPlace)
    expect(await db.places.get(item.placeId)).toMatchObject({
      name:'Private cableway visit', address:'Custom meeting point', googleMapsUrl:'https://maps.example/custom',
    })
  })

  it('moves a grouped activity through the shared editor without rewriting its expense snapshot', async () => {
    await initializeDatabase()
    const template = (await loadData()).activityTemplates.find(item => item.name === 'Cape Peninsula Tour')!
    const parent = await materializeTemplate(template, '2026-09-22', { amount:80, currency:'USD' })
    const originalExpense = (await db.expenses.where('itineraryItemId').equals(parent.id).first())!
    await saveItineraryDetails(parent.id, { dayId:'2026-09-24' }, { amount:90, currency:'ZAR' })
    expect((await db.items.get(parent.id))?.dayId).toBe('2026-09-24')
    expect((await db.items.where('parentId').equals(parent.id).toArray()).every(child => child.dayId === '2026-09-24')).toBe(true)
    expect(await db.expenses.get(originalExpense.id)).toMatchObject({ amount:90, currency:'ZAR', date:'2026-09-22', rateSetId:originalExpense.rateSetId })
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

  it('preserves a group place while another itinerary item still references it', async () => {
    await initializeDatabase()
    const timestamp = new Date().toISOString()
    const place: Place = { id:'shared-group-place', name:'Shared place', wantToVisit:false, createdAt:timestamp, updatedAt:timestamp }
    await db.places.add(place)
    await db.items.bulkAdd([
      { id:'shared-group', dayId:'2026-09-22', placeId:place.id, isActivityGroup:true, visited:false, position:1, createdAt:timestamp, updatedAt:timestamp },
      { id:'shared-standalone', dayId:'2026-09-23', placeId:place.id, visited:false, position:1, createdAt:timestamp, updatedAt:timestamp },
    ])
    await deleteItineraryGroup('shared-group')
    expect(await db.places.get(place.id)).toEqual(place)
    expect(await db.items.get('shared-standalone')).toBeTruthy()
  })

  it('preserves and flags days when trip dates are shortened', async () => {
    await initializeDatabase()
    const data = await loadData()
    await saveTrip({ ...data.trip, endDate: '2026-09-25' })
    const changed = await loadData()
    expect(changed.days).toHaveLength(8)
    expect(changed.days.find(day => day.date === '2026-09-28')?.outOfRange).toBe(true)
  })

  it('atomically creates a place, itinerary item, and linked activity expense', async () => {
    await initializeDatabase()
    await db.rateSets.add({ id:'active-rates',label:'Active',effectiveDate:'2026-09-01',kesPerKes:1,kesPerUsd:130,kesPerZar:7,active:true,example:false,createdAt:'2026-09-01T00:00:00Z' })
    const timestamp = '2026-09-15T00:00:00Z'
    const place: Place = { id:'new-place',name:'Museum',wantToVisit:true,createdAt:timestamp,updatedAt:timestamp }
    const item: ItineraryItem = { id:'new-item',dayId:'2026-09-22',placeId:place.id,visited:false,position:1,createdAt:timestamp,updatedAt:timestamp }
    await createItineraryPlace(place, item, { amount:25, currency:'USD' })
    expect(await db.places.get(place.id)).toBeTruthy()
    expect(await db.items.get(item.id)).toBeTruthy()
    expect(await db.expenses.where('itineraryItemId').equals(item.id).first()).toMatchObject({
      amount:25, currency:'USD', date:'2026-09-22', category:'Activity', rateSetId:'active-rates',
    })
  })

  it('upserts a linked cost idempotently while preserving its date and rate snapshot', async () => {
    await initializeDatabase()
    const item = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-22', { amount:10, currency:'USD' })
    const original = (await db.expenses.where('itineraryItemId').equals(item.id).first())!
    await db.expenses.update(original.id, { note:'Paid at the desk' })
    await saveItineraryDetails(item.id, { dayId:'2026-09-24', notes:'Booked' }, { amount:20, currency:'ZAR' })
    await saveItineraryDetails(item.id, {}, { amount:30, currency:'KES' })
    const expenses = await db.expenses.where('itineraryItemId').equals(item.id).toArray()
    expect(expenses).toHaveLength(1)
    expect(expenses[0]).toMatchObject({ id:original.id, amount:30, currency:'KES', date:original.date, rateSetId:original.rateSetId, note:'Paid at the desk' })
    await saveItineraryDetails(item.id, { notes:'Still booked' }, undefined)
    expect((await db.expenses.get(original.id))?.amount).toBe(30)
    await saveItineraryDetails(item.id, {}, null)
    expect(await db.expenses.get(original.id)).toBeUndefined()
  })

  it('atomically edits the linked place name without replacing its location fields', async () => {
    await initializeDatabase()
    const placeId = 'seed-place-table-mountain'
    await db.places.update(placeId, { address:'Cableway Road', googleMapsUrl:'https://maps.example/mountain' })
    const item = await scheduleCandidatePlace(placeId, '2026-09-22')
    await saveItineraryDetails(item.id, { name:'  Table Mountain Cableway  ', time:'09:30', bookingStatus:'Booked', notes:'Bring tickets' }, { amount:30, currency:'USD' })
    expect(await db.places.get(placeId)).toMatchObject({
      name:'Table Mountain Cableway', address:'Cableway Road', googleMapsUrl:'https://maps.example/mountain',
    })
    expect(await db.items.get(item.id)).toMatchObject({ time:'09:30', bookingStatus:'Booked', notes:'Bring tickets' })
    expect(await db.expenses.where('itineraryItemId').equals(item.id).count()).toBe(1)
  })

  it('rolls back place and item edits when linked cost saving fails', async () => {
    await initializeDatabase()
    const item = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-22')
    await expect(saveItineraryDetails(item.id, { name:'Changed', time:'10:00' }, { amount:Number.NaN, currency:'USD' })).rejects.toThrow('finite amount')
    expect((await db.places.get(item.placeId))?.name).toBe('Table Mountain')
    expect((await db.items.get(item.id))?.time).toBeUndefined()
  })

  it('creates standalone entries with a blank parent', async () => {
    await initializeDatabase()
    const timestamp = '2026-09-15T00:00:00Z'
    const place: Place = { id:'standalone-place',name:'Standalone',wantToVisit:false,createdAt:timestamp,updatedAt:timestamp }
    const item: ItineraryItem = { id:'standalone-item',dayId:'2026-09-23',placeId:place.id,parentId:undefined,visited:false,position:1,createdAt:timestamp,updatedAt:timestamp }
    await createItineraryPlace(place, item)
    expect((await db.items.get(item.id))?.parentId).toBeUndefined()
  })

  it('assigns, changes, and removes parents while maintaining group flags', async () => {
    await initializeDatabase()
    const first = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-23')
    const second = await scheduleCandidatePlace('seed-place-bo-kaap', '2026-09-23')
    const child = await scheduleCandidatePlace('seed-place-camps-bay', '2026-09-23')
    await saveItineraryDetails(child.id, { parentId:first.id }, undefined)
    expect(await db.items.get(first.id)).toMatchObject({ isActivityGroup:true })
    await saveItineraryDetails(child.id, { parentId:second.id }, undefined)
    expect((await db.items.get(first.id))?.isActivityGroup).toBe(false)
    expect(await db.items.get(second.id)).toMatchObject({ isActivityGroup:true })
    await saveItineraryDetails(child.id, { parentId:undefined }, undefined)
    expect((await db.items.get(child.id))?.parentId).toBeUndefined()
    expect((await db.items.get(second.id))?.isActivityGroup).toBe(false)
  })

  it('supports creating a child directly under an existing same-day parent', async () => {
    await initializeDatabase()
    const parent = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-23')
    const timestamp = '2026-09-15T00:00:00Z'
    const place: Place = { id:'child-place',name:'Child',wantToVisit:false,createdAt:timestamp,updatedAt:timestamp }
    const child: ItineraryItem = { id:'child-item',dayId:'2026-09-23',placeId:place.id,parentId:parent.id,visited:false,position:1,createdAt:timestamp,updatedAt:timestamp }
    await createItineraryPlace(place, child)
    expect(await db.items.get(child.id)).toMatchObject({ parentId:parent.id })
    expect(await db.items.get(parent.id)).toMatchObject({ isActivityGroup:true })
  })

  it('rejects invalid parent relationships without moving days', async () => {
    await initializeDatabase()
    const parent = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-23')
    const child = await scheduleCandidatePlace('seed-place-bo-kaap', '2026-09-23')
    const otherDay = await scheduleCandidatePlace('seed-place-camps-bay', '2026-09-24')
    await saveItineraryDetails(child.id, { parentId:parent.id }, undefined)
    await expect(saveItineraryDetails(parent.id, { parentId:parent.id }, undefined)).rejects.toThrow('own parent')
    await expect(saveItineraryDetails(parent.id, { parentId:child.id }, undefined)).rejects.toThrow('child itinerary item')
    await expect(saveItineraryDetails(otherDay.id, { parentId:parent.id }, undefined)).rejects.toThrow('same day')
    await expect(saveItineraryDetails(child.id, { dayId:'2026-09-24' }, undefined)).rejects.toThrow('same day')
    expect((await db.items.get(child.id))?.dayId).toBe('2026-09-23')
  })

  it('preserves a legacy group flag while it still has children', async () => {
    await initializeDatabase()
    const parent = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-23')
    const first = await scheduleCandidatePlace('seed-place-bo-kaap', '2026-09-23')
    const second = await scheduleCandidatePlace('seed-place-camps-bay', '2026-09-23')
    await saveItineraryDetails(first.id, { parentId:parent.id }, undefined)
    await saveItineraryDetails(second.id, { parentId:parent.id }, undefined)
    await saveItineraryDetails(first.id, { parentId:undefined }, undefined)
    expect(await db.items.get(parent.id)).toMatchObject({ isActivityGroup:true })
  })

  it('unlinks rather than deletes a real expense when an item is deleted', async () => {
    await initializeDatabase()
    const item = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-22', { amount:10, currency:'USD' })
    const expense = (await db.expenses.where('itineraryItemId').equals(item.id).first())!
    await deleteItineraryItem(item.id)
    expect(await db.expenses.get(expense.id)).toMatchObject({ id:expense.id, amount:10 })
    expect(await db.expenses.get(expense.id)).not.toHaveProperty('itineraryItemId')
  })

  it('rolls back scheduling and candidate changes when cost validation fails', async () => {
    await initializeDatabase()
    await db.places.update('seed-place-table-mountain', { wantToVisit:true })
    const before = await db.items.where('placeId').equals('seed-place-table-mountain').count()
    await expect(scheduleCandidatePlace('seed-place-table-mountain', '2026-09-22', { amount:0, currency:'USD' })).rejects.toThrow('greater than zero')
    expect(await db.items.where('placeId').equals('seed-place-table-mountain').count()).toBe(before)
    expect((await db.places.get('seed-place-table-mountain'))?.wantToVisit).toBe(true)
  })

  it('schedules a candidate and adds a template cost only to the materialized root', async () => {
    await initializeDatabase()
    await db.places.update('seed-place-table-mountain', { wantToVisit:true })
    const candidate = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-22', { amount:15, currency:'ZAR' })
    expect((await db.places.get(candidate.placeId))?.wantToVisit).toBe(false)
    const template = (await db.activityTemplates.get('seed-template-cape-peninsula'))!
    const root = await materializeTemplate(template, '2026-09-24', { amount:200, currency:'USD' })
    const children = await db.items.where('parentId').equals(root.id).toArray()
    expect(await db.expenses.where('itineraryItemId').equals(root.id).count()).toBe(1)
    expect(await db.expenses.where('itineraryItemId').anyOf(children.map(child => child.id)).count()).toBe(0)
  })
})
