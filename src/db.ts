import Dexie, { type EntityTable } from 'dexie'
import type { ActivityTemplate, AppData, AppMetadata, ChecklistItem, Expense, ItineraryDay, ItineraryItem, PhotoEntry, Place, RateSet, TravelStamp, Trip } from './types'

const now = () => new Date().toISOString()
export const makeId = () => crypto.randomUUID()

export function datesBetween(start: string, end: string): string[] {
  if (!start || !end || start > end) return []
  const result: string[] = []
  const cursor = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

class TravelDatabase extends Dexie {
  trips!: EntityTable<Trip, 'id'>
  checklist!: EntityTable<ChecklistItem, 'id'>
  days!: EntityTable<ItineraryDay, 'id'>
  items!: EntityTable<ItineraryItem, 'id'>
  places!: EntityTable<Place, 'id'>
  activityTemplates!: EntityTable<ActivityTemplate, 'id'>
  expenses!: EntityTable<Expense, 'id'>
  stamps!: EntityTable<TravelStamp, 'id'>
  photos!: EntityTable<PhotoEntry, 'id'>
  rateSets!: EntityTable<RateSet, 'id'>
  metadata!: EntityTable<AppMetadata, 'key'>
  constructor() {
    super('cape-town-travel-notebook')
    this.version(1).stores({
      trips: 'id', checklist: 'id, category, completed', days: 'id, date',
      items: 'id, dayId, placeId, position, visited', places: 'id, wantToVisit',
      expenses: 'id, date, currency, rateSetId', stamps: 'id, itineraryItemId, visitDate, detached',
      photos: 'id, stampId', rateSets: 'id, active', metadata: 'key',
    })
    this.version(2).stores({ activityTemplates: 'id, name, seeded' })
  }
}
export const db = new TravelDatabase()

const seededPlaceNames = [
  'V&A Waterfront', 'Sea Point', 'Camps Bay', 'Table Mountain', 'Bo-Kaap',
  'Boulders Beach', 'Boulders Penguin Colony', 'Hout Bay', 'Cape of Good Hope',
  'Cape Point', 'New Cape Point Lighthouse', "Simon's Town", 'Muizenberg Beach',
  "Chapman's Peak Drive",
] as const
const placeId = (name: string) => `seed-place-${name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
const mapsUrl = (name: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, Cape Town, South Africa`)}`

async function ensurePlanningSeeds() {
  if ((await db.metadata.get('planningSeedsV1'))?.value === 'complete') return
  const createdAt = now()
  const places: Place[] = seededPlaceNames.map(name => ({
    id: placeId(name), name, googleMapsUrl: mapsUrl(name), wantToVisit: false, seeded: true, createdAt, updatedAt: createdAt,
  }))
  const stop = (placeName: string, notes: string[] = [], approximateMinutes?: number, optional?: boolean) => ({
    id: `${placeId(placeName)}-stop`, placeName, placeId: seededPlaceNames.includes(placeName as typeof seededPlaceNames[number]) ? placeId(placeName) : undefined,
    notes, approximateMinutes, optional,
  })
  const templates: ActivityTemplate[] = [
    {
      id: 'seed-template-red-bus', name: 'Cape Town Red Bus / Hop-On Hop-Off',
      description: 'Planning template only. Add route and stop choices in the itinerary notes; no pass or route is assumed.',
      stops: [stop('Cape Town Red Bus / Hop-On Hop-Off', ['Choose route and stops later'])],
      seeded: true, createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-template-table-mountain', name: 'Table Mountain',
      description: 'Planning activity only. No ticket or tour is assumed.',
      stops: [stop('Table Mountain')],
      seeded: true, createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-template-cape-peninsula', name: 'Cape Peninsula Tour',
      description: 'Reusable planning sequence. All stops remain editable and movable after adding it to a day.',
      stops: [
        stop('Bo-Kaap', ['Photo stop', 'Visit', 'Guided tour', 'Walk'], 10),
        stop('Boulders Beach', ['Photo stop', 'Sightseeing', 'Walk', 'Scenic views'], 75),
        stop('Hout Bay Boatyard, Cape Town', ['Photo stop', 'Shopping', 'Sightseeing', 'Scenic views'], 50),
        stop("Chapman's Peak Drive", ['Photo stop', 'Sightseeing', 'Scenic drive', 'Scenic views'], 20, true),
        stop('Cape of Good Hope', ['Photo stop', 'Sightseeing', 'Walk', 'Scenic views'], 30),
        stop('New Cape Point Lighthouse', ['Photo stop', 'Sightseeing', 'Walk', 'Scenic views'], 45),
        stop('Boulders Penguin Colony', ['Photo stop', 'Sightseeing', 'Walk'], 60),
        stop("Simon's Town", ['Photo stop', 'Lunch', 'Walk'], 75),
        stop('Muizenberg Beach', ['Photo stop', 'Coffee', 'Walk', 'Scenic views'], 25),
      ],
      seeded: true, createdAt, updatedAt: createdAt,
    },
  ]
  await db.transaction('rw', [db.places, db.activityTemplates, db.metadata], async () => {
    for (const place of places) if (!(await db.places.get(place.id))) await db.places.add(place)
    await db.activityTemplates.bulkPut(templates)
    await db.metadata.put({ key: 'planningSeedsV1', value: 'complete' })
    await db.metadata.put({ key: 'schemaVersion', value: '2' })
  })
}

export async function initializeDatabase() {
  if (!(await db.trips.get('current'))) {
    const timestamp = now()
    const trip: Trip = { id: 'current', destination: 'Cape Town, South Africa', travellers: 2, startDate: '2026-09-21', endDate: '2026-09-28', timezone: 'Africa/Johannesburg', notes: '', updatedAt: timestamp }
    const checklist: ChecklistItem[] = [
      ['Review travel insurance', 'Documents'], ['Create an offline backup', 'Planning'],
      ['Check passport validity', 'Documents'], ['Pack a light rain layer', 'Packing'],
    ].map(([title, category]) => ({ id: makeId(), title, category, completed: false, note: 'Starter suggestion — verify for your trip.', createdAt: timestamp, updatedAt: timestamp }))
    const days = datesBetween(trip.startDate, trip.endDate).map(date => ({ id: date, date, outOfRange: false }))
    const exampleRates: RateSet = { id: makeId(), label: 'Example rates — activate only after reviewing', effectiveDate: '2026-09-01', kesPerKes: 1, kesPerUsd: 129, kesPerZar: 7.2, active: false, example: true, createdAt: timestamp }
    await db.transaction('rw', [db.trips, db.checklist, db.days, db.rateSets, db.metadata], async () => {
      await db.trips.add(trip); await db.checklist.bulkAdd(checklist); await db.days.bulkAdd(days); await db.rateSets.add(exampleRates)
      await db.metadata.bulkAdd([{ key: 'schemaVersion', value: '2' }, { key: 'displayCurrency', value: 'KES' }])
    })
  }
  await ensurePlanningSeeds()
}

export async function loadData(): Promise<AppData> {
  const [trip, checklist, days, items, places, activityTemplates, expenses, stamps, photos, rateSets, metadata] = await Promise.all([
    db.trips.get('current'), db.checklist.toArray(), db.days.orderBy('date').toArray(), db.items.toArray(),
    db.places.toArray(), db.activityTemplates.toArray(), db.expenses.toArray(), db.stamps.toArray(), db.photos.toArray(), db.rateSets.toArray(), db.metadata.toArray(),
  ])
  if (!trip) throw new Error('Trip data could not be loaded.')
  return { trip, checklist, days, items, places, activityTemplates, expenses, stamps, photos, rateSets, metadata }
}

export async function saveTrip(trip: Trip) {
  const requiredDates = new Set(datesBetween(trip.startDate, trip.endDate))
  await db.transaction('rw', [db.trips, db.days], async () => {
    await db.trips.put({ ...trip, updatedAt: now() })
    const existing = await db.days.toArray()
    await db.days.bulkPut(existing.map(day => ({ ...day, outOfRange: !requiredDates.has(day.date) })))
    const existingDates = new Set(existing.map(day => day.date))
    const additions = [...requiredDates].filter(date => !existingDates.has(date)).map(date => ({ id: date, date, outOfRange: false }))
    if (additions.length) await db.days.bulkAdd(additions)
  })
}

export async function deleteItineraryItem(id: string) {
  await db.transaction('rw', [db.items, db.stamps], async () => {
    const stamp = await db.stamps.where('itineraryItemId').equals(id).first()
    if (stamp) await db.stamps.update(stamp.id, { itineraryItemId: undefined, detached: true })
    await db.items.delete(id)
  })
}

export async function replaceAll(data: AppData) {
  await db.transaction('rw', [db.trips, db.checklist, db.days, db.items, db.places, db.activityTemplates, db.expenses, db.stamps, db.photos, db.rateSets, db.metadata], async () => {
    await Promise.all([db.trips.clear(), db.checklist.clear(), db.days.clear(), db.items.clear(), db.places.clear(), db.activityTemplates.clear(), db.expenses.clear(), db.stamps.clear(), db.photos.clear(), db.rateSets.clear(), db.metadata.clear()])
    await db.trips.add(data.trip)
    await Promise.all([db.checklist.bulkAdd(data.checklist), db.days.bulkAdd(data.days), db.items.bulkAdd(data.items), db.places.bulkAdd(data.places), db.activityTemplates.bulkAdd(data.activityTemplates), db.expenses.bulkAdd(data.expenses), db.stamps.bulkAdd(data.stamps), db.photos.bulkAdd(data.photos), db.rateSets.bulkAdd(data.rateSets), db.metadata.bulkAdd(data.metadata)])
  })
}
