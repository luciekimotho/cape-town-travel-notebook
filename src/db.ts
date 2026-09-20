import Dexie, { type EntityTable } from 'dexie'
import { validateNotebookStampDesigns, validateStampDesign } from './stampDesign'
import { normalizeItineraryLink } from './itineraryLink'
import type { ActivityTemplate, AppData, AppMetadata, ChecklistItem, Currency, Expense, ItineraryDay, ItineraryItem, PhotoEntry, Place, RateSet, TravelStamp, Trip } from './types'

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
    this.version(3).stores({ items: 'id, dayId, placeId, parentId, position, visited' })
    this.version(4).stores({ expenses: 'id, date, currency, rateSetId, &itineraryItemId' })
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
    if ((await db.metadata.get('planningSeedsV1'))?.value === 'complete') return
    for (const place of places) if (!(await db.places.get(place.id))) await db.places.add(place)
    await db.activityTemplates.bulkPut(templates)
    await db.metadata.put({ key: 'planningSeedsV1', value: 'complete' })
    await db.metadata.put({ key: 'schemaVersion', value: '4' })
  })
}

async function ensureShoppingSeeds() {
  await db.transaction('rw', [db.checklist, db.metadata], async () => {
    if ((await db.metadata.get('shoppingSeedsV1'))?.value === 'complete') return
    const existing = await db.checklist.toArray()
    const createdAt = now()
    const shopping = [
      ['seed-shopping-sneakers', 'Sneakers'],
      ['seed-shopping-golf', 'Golf stuff'],
      ['seed-shopping-kids-clothes', "Kids' clothes"],
    ] as const
    for (const [id, title] of shopping) {
      const duplicate = existing.some(item => item.category.toLowerCase() === 'shopping' && item.title.trim().toLowerCase() === title.toLowerCase())
      if (!duplicate && !await db.checklist.get(id)) {
        await db.checklist.add({ id, title, category:'Shopping', completed:false, createdAt, updatedAt:createdAt })
      }
    }
    await db.metadata.put({ key:'shoppingSeedsV1', value:'complete' })
  })
}

async function ensureChecklistCategories() {
  await db.transaction('rw', [db.checklist, db.metadata], async () => {
    if ((await db.metadata.get('checklistCategoriesV1'))?.value === 'complete') return
    const starters = await db.checklist.toArray()
    for (const item of starters) {
      if (item.title === 'Create an offline backup' && item.note === 'Starter suggestion — verify for your trip.') {
        await db.checklist.delete(item.id)
      }
      if (item.title === 'Pack a light rain layer' && item.category === 'Packing' && item.note === 'Starter suggestion — verify for your trip.') {
        await db.checklist.update(item.id, { category:'Planning', updatedAt:now() })
      }
    }
    await db.metadata.put({ key:'checklistCategoriesV1', value:'complete' })
  })
}

async function ensureDatedItinerarySeeds() {
  await db.transaction('rw', [db.days, db.items, db.places, db.activityTemplates, db.metadata], async () => {
    if ((await db.metadata.get('datedItinerarySeedsV1'))?.value === 'complete') return
    const templates = await db.activityTemplates.toArray()
    const peninsula = templates.find(template => template.name === 'Cape Peninsula Tour')
    const peninsulaChildren = (peninsula?.stops ?? []).map(stop => {
      const duration = stop.approximateMinutes
        ? `Approx. ${stop.approximateMinutes >= 60 && stop.approximateMinutes % 60 === 0 ? `${stop.approximateMinutes / 60} hour` : `${stop.approximateMinutes} min`}`
        : ''
      return { name:stop.placeName, notes:[stop.optional ? 'Optional' : '', ...stop.notes, duration].filter(Boolean).join(' · ') }
    })
    const plans: Array<{ key:string; dayId:string; name:string; children:Array<{ name:string; notes?:string }> }> = [
      { key:'arrival-waterfront', dayId:'2026-09-21', name:'Arrival & V&A Waterfront', children:[
        {name:'Arrive in Cape Town (CPT)'}, {name:'Check in',notes:'Hyatt Regency or StayEasy · accommodation not selected'}, {name:'Explore V&A Waterfront'}, {name:'Light shopping'}, {name:'Dinner at the Waterfront'},
      ]},
      { key:'red-bus-mountain', dayId:'2026-09-22', name:'Red Bus & Table Mountain', children:[
        {name:'Cape Town Red Bus / Hop-On Hop-Off'}, {name:'Table Mountain'}, {name:'City sights',notes:"Bo-Kaap · Company's Garden"}, {name:'Camps Bay & Clifton'}, {name:'Sunset dinner'},
      ]},
      { key:'flexible-day', dayId:'2026-09-23', name:'Flexible Day', children:[
        {name:'Kirstenbosch + wine tasting',notes:'Option 1 · Constantia'}, {name:'Relaxed day',notes:'Option 2 · Cafés · beach · spa · museum · city exploring'},
      ]},
      { key:'move-sea-point', dayId:'2026-09-24', name:'Move to Sea Point', children:[
        {name:'Check out and transfer to Sea Point',notes:'Airbnb details not set'}, {name:'Settle in'}, {name:'Sea Point Promenade'}, {name:'Cafés and local dining'},
      ]},
      { key:'cape-peninsula', dayId:'2026-09-25', name:'Cape Peninsula Tour', children:peninsulaChildren },
      { key:'golf-wine', dayId:'2026-09-26', name:'Golf & Wine Tour', children:[
        {name:'Morning golf',notes:'9 or 18 holes · course not selected'}, {name:'Wine tasting',notes:'Stellenbosch or Franschhoek'}, {name:'Long lunch'}, {name:'Return to Cape Town'},
      ]},
      { key:'shopping-cruise', dayId:'2026-09-27', name:'Shopping & Sunset Cruise', children:[
        {name:'Shopping in Sea Point',notes:'The Point Mall · Piazza St John'}, {name:'V&A Waterfront final shopping'}, {name:'Sunset cruise'}, {name:'Farewell dinner'},
      ]},
      { key:'departure', dayId:'2026-09-28', name:'Departure', children:[
        {name:'Breakfast'}, {name:'Check out'}, {name:'Transfer to Cape Town International Airport'},
      ]},
    ]
    const createdAt = now()
    const placeFor = async (key:string, name:string, notes?:string) => {
      const existing = await db.places.filter(place => place.name.trim().toLowerCase() === name.trim().toLowerCase()).first()
      if (existing) return existing
      const place: Place = { id:`dated-place-${key}`, name, notes, wantToVisit:false, seeded:false, createdAt, updatedAt:createdAt }
      await db.places.add(place)
      return place
    }
    for (const [planIndex, plan] of plans.entries()) {
      if (!await db.days.get(plan.dayId)) continue
      let alreadyScheduled = false
      for (const item of await db.items.where('dayId').equals(plan.dayId).toArray()) {
        if ((await db.places.get(item.placeId))?.name.trim().toLowerCase() === plan.name.toLowerCase()) {
          alreadyScheduled = true
          break
        }
      }
      if (alreadyScheduled || await db.items.get(`dated-item-${plan.key}`)) continue
      const parentPlace = await placeFor(plan.key, plan.name)
      const parent: ItineraryItem = { id:`dated-item-${plan.key}`, dayId:plan.dayId, placeId:parentPlace.id, isActivityGroup:true, visited:false, position:planIndex, createdAt, updatedAt:createdAt }
      await db.items.add(parent)
      for (const [childIndex, child] of plan.children.entries()) {
        const childPlace = await placeFor(`${plan.key}-${childIndex}`,child.name,child.notes)
        await db.items.add({ id:`dated-item-${plan.key}-${childIndex}`, dayId:plan.dayId, placeId:childPlace.id, parentId:parent.id, notes:child.notes, visited:false, position:childIndex, createdAt, updatedAt:createdAt })
      }
    }
    await db.metadata.put({ key:'datedItinerarySeedsV1', value:'complete' })
  })
}

export async function initializeDatabase() {
  await db.transaction('rw', [db.trips, db.checklist, db.days, db.rateSets, db.metadata], async () => {
    if (await db.trips.get('current')) return
    const timestamp = now()
    const trip: Trip = { id: 'current', destination: 'Cape Town, South Africa', travellers: 2, startDate: '2026-09-21', endDate: '2026-09-28', timezone: 'Africa/Johannesburg', notes: '', updatedAt: timestamp }
    const checklist: ChecklistItem[] = [
      ['Review travel insurance', 'Documents'], ['Check passport validity', 'Documents'],
      ['Pack a light rain layer', 'Planning'],
    ].map(([title, category]) => ({ id: makeId(), title, category, completed: false, note: 'Starter suggestion — verify for your trip.', createdAt: timestamp, updatedAt: timestamp }))
    const days = datesBetween(trip.startDate, trip.endDate).map(date => ({ id: date, date, outOfRange: false }))
    const exampleRates: RateSet = { id: makeId(), label: 'Example rates — activate only after reviewing', effectiveDate: '2026-09-01', kesPerKes: 1, kesPerUsd: 129, kesPerZar: 7.2, active: false, example: true, createdAt: timestamp }
    await db.trips.add(trip); await db.checklist.bulkAdd(checklist); await db.days.bulkAdd(days); await db.rateSets.add(exampleRates)
    await db.metadata.bulkAdd([{ key: 'schemaVersion', value: '4' }, { key: 'displayCurrency', value: 'KES' }])
  })
  await ensurePlanningSeeds()
  await ensureShoppingSeeds()
  await ensureChecklistCategories()
  await ensureDatedItinerarySeeds()
  await db.metadata.put({ key: 'schemaVersion', value: '4' })
}

export async function loadData(): Promise<AppData> {
  const [trip, checklist, days, items, places, activityTemplates, expenses, stamps, photos, rateSets, metadata] = await Promise.all([
    db.trips.get('current'), db.checklist.toArray(), db.days.orderBy('date').toArray(), db.items.toArray(),
    db.places.toArray(), db.activityTemplates.toArray(), db.expenses.toArray(), db.stamps.toArray(), db.photos.toArray(), db.rateSets.toArray(), db.metadata.toArray(),
  ])
  if (!trip) throw new Error('Trip data could not be loaded.')
  const data = { trip, checklist, days, items, places, activityTemplates, expenses, stamps, photos, rateSets, metadata }
  validateNotebookStampDesigns(data)
  return data
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

export interface LinkedCostInput {
  amount: number
  currency: Currency
  note?: string
}

export type ItineraryDetailsPatch = Partial<Pick<ItineraryItem, 'stampKind' | 'dayId' | 'parentId' | 'time' | 'linkUrl' | 'notes' | 'bookingStatus' | 'visited' | 'position'>> & {
  name?: string
  address?: string
  googleMapsUrl?: string
}

type PlaceDetailsPatch = Partial<Pick<Place, 'stampKind' | 'name' | 'address' | 'googleMapsUrl' | 'notes'>>
type ScheduledItemPatch = Partial<Pick<ItineraryItem, 'stampKind' | 'parentId' | 'time' | 'linkUrl' | 'bookingStatus' | 'notes'>>
type MaterializeDetails = PlaceDetailsPatch & ScheduledItemPatch

const currencies: readonly Currency[] = ['KES', 'USD', 'ZAR']

function validateLinkedCost(cost: LinkedCostInput) {
  if (!Number.isFinite(cost.amount) || cost.amount <= 0) throw new Error('Activity cost must be a finite amount greater than zero.')
  if (!currencies.includes(cost.currency)) throw new Error('Activity cost currency is invalid.')
}

async function addLinkedExpense(item: ItineraryItem, cost: LinkedCostInput, createdAt: string): Promise<Expense> {
  validateLinkedCost(cost)
  if (await db.expenses.where('itineraryItemId').equals(item.id).first()) throw new Error('This itinerary item already has an activity cost.')
  const day = await db.days.get(item.dayId)
  if (!day) throw new Error('The itinerary day does not exist.')
  const rateSet = await db.rateSets.filter(candidate => candidate.active).first()
  const expense: Expense = {
    id: makeId(), amount: cost.amount, currency: cost.currency, date: day.date,
    category: 'Activity', note: cost.note, rateSetId: rateSet?.id,
    itineraryItemId: item.id, createdAt, updatedAt: createdAt,
  }
  await db.expenses.add(expense)
  return expense
}

async function validateParentAssignment(itemId: string, dayId: string, parentId: string) {
  if (parentId === itemId) throw new Error('An itinerary item cannot be its own parent.')
  const parent = await db.items.get(parentId)
  if (!parent) throw new Error('The parent itinerary item does not exist.')
  if (parent.parentId) throw new Error('A child itinerary item cannot be used as a parent.')
  if (parent.dayId !== dayId) throw new Error('Parent and child itinerary items must be on the same day.')
  let ancestor: ItineraryItem | undefined = parent
  while (ancestor?.parentId) {
    if (ancestor.parentId === itemId) throw new Error('The parent assignment would create a cycle.')
    ancestor = await db.items.get(ancestor.parentId)
  }
}

async function updateParentGroupFlags(oldParentId: string | undefined, newParentId: string | undefined, updatedAt: string) {
  if (oldParentId === newParentId) return
  if (newParentId) await db.items.update(newParentId, { isActivityGroup: true, updatedAt })
  if (oldParentId && await db.items.where('parentId').equals(oldParentId).count() === 0) {
    await db.items.update(oldParentId, { isActivityGroup: false, updatedAt })
  }
}

export async function createItineraryPlace(place: Place, item: ItineraryItem, cost?: LinkedCostInput): Promise<ItineraryItem> {
  validateStampDesign(place.stampKind)
  validateStampDesign(item.stampKind)
  item.linkUrl = normalizeItineraryLink(item.linkUrl)
  await db.transaction('rw', [db.places, db.items, db.expenses, db.days, db.rateSets], async () => {
    if (!await db.days.get(item.dayId)) throw new Error('The itinerary day does not exist.')
    if (item.parentId) await validateParentAssignment(item.id, item.dayId, item.parentId)
    await db.places.add(place)
    await db.items.add(item)
    if (item.parentId) await db.items.update(item.parentId, { isActivityGroup: true, updatedAt: now() })
    if (cost !== undefined) await addLinkedExpense(item, cost, now())
  })
  return item
}

export async function scheduleCandidatePlace(placeId: string, dayId: string, cost?: LinkedCostInput, placePatch?: PlaceDetailsPatch, itemPatch?: ScheduledItemPatch): Promise<ItineraryItem> {
  validateStampDesign(placePatch?.stampKind)
  validateStampDesign(itemPatch?.stampKind)
  const createdAt = now()
  const item: ItineraryItem = { id: makeId(), dayId, placeId, ...itemPatch, linkUrl: normalizeItineraryLink(itemPatch?.linkUrl), visited: false, position: Date.now(), createdAt, updatedAt: createdAt }
  await db.transaction('rw', [db.places, db.items, db.stamps, db.expenses, db.days, db.rateSets], async () => {
    const place = await db.places.get(placeId)
    if (!place) throw new Error('The place does not exist.')
    if (!await db.days.get(dayId)) throw new Error('The itinerary day does not exist.')
    if (item.parentId) await validateParentAssignment(item.id, dayId, item.parentId)
    await db.items.add(item)
    if (item.parentId) await db.items.update(item.parentId, { isActivityGroup: true, updatedAt: createdAt })
    await db.places.update(placeId, { ...placePatch, wantToVisit: false, updatedAt: createdAt })
    if (placePatch && 'stampKind' in placePatch) await refreshPlaceStampDesigns(placeId)
    if (cost !== undefined) await addLinkedExpense(item, cost, createdAt)
  })
  return item
}

export async function saveItineraryDetails(itemId: string, patch: ItineraryDetailsPatch, linkedCost: LinkedCostInput | null | undefined): Promise<void> {
  validateStampDesign(patch.stampKind)
  if ('linkUrl' in patch) patch.linkUrl = normalizeItineraryLink(patch.linkUrl)
  await db.transaction('rw', [db.items, db.places, db.stamps, db.expenses, db.days, db.rateSets], async () => {
    const item = await db.items.get(itemId)
    if (!item) throw new Error('The itinerary item does not exist.')
    const changesAddress = Object.prototype.hasOwnProperty.call(patch, 'address')
    const changesMapUrl = Object.prototype.hasOwnProperty.call(patch, 'googleMapsUrl')
    const { name, address, googleMapsUrl, ...itemPatch } = patch
    const changesParent = Object.prototype.hasOwnProperty.call(itemPatch, 'parentId')
    const nextParentId = changesParent ? itemPatch.parentId : item.parentId
    const nextDayId = itemPatch.dayId ?? item.dayId
    if (!await db.days.get(nextDayId)) throw new Error('The itinerary day does not exist.')
    if (nextParentId) {
      await validateParentAssignment(itemId, nextDayId, nextParentId)
      if (nextParentId !== item.parentId && await db.items.where('parentId').equals(itemId).count() > 0) {
        throw new Error('An itinerary group with children cannot become a child item.')
      }
    }
    const updatedAt = now()
    if (name !== undefined || changesAddress || changesMapUrl) {
      const placePatch: PlaceDetailsPatch & { updatedAt: string } = { updatedAt }
      if (name !== undefined) {
        const normalizedName = name.trim()
        if (!normalizedName) throw new Error('Place name is required.')
        placePatch.name = normalizedName
      }
      if (changesAddress) placePatch.address = address
      if (changesMapUrl) placePatch.googleMapsUrl = googleMapsUrl
      if (await db.places.update(item.placeId, placePatch) !== 1) {
        throw new Error('The linked place does not exist.')
      }
    }
    await db.items.update(itemId, { ...itemPatch, updatedAt })
    if ('stampKind' in patch) await refreshItemStampDesign(itemId)
    if (itemPatch.dayId !== undefined && itemPatch.dayId !== item.dayId && !nextParentId) {
      await db.items.where('parentId').equals(itemId).modify({ dayId: itemPatch.dayId, updatedAt })
    }
    if (changesParent) await updateParentGroupFlags(item.parentId, nextParentId, updatedAt)
    if (linkedCost === undefined) return
    const existing = await db.expenses.where('itineraryItemId').equals(itemId).first()
    if (linkedCost === null) {
      if (existing) await db.expenses.delete(existing.id)
      return
    }
    validateLinkedCost(linkedCost)
    if (existing) {
      await db.expenses.update(existing.id, { amount: linkedCost.amount, currency: linkedCost.currency, updatedAt: now() })
    } else {
      await addLinkedExpense({ ...item, ...itemPatch }, linkedCost, now())
    }
  })
}

export async function deleteItineraryItem(id: string) {
  await db.transaction('rw', [db.items, db.places, db.stamps, db.expenses], async () => {
    const item = await db.items.get(id)
    await refreshItemStampDesign(id)
    const stamp = await db.stamps.where('itineraryItemId').equals(id).first()
    if (stamp) await db.stamps.where('id').equals(stamp.id).modify(memory => {
      delete memory.itineraryItemId
      memory.detached = true
    })
    await db.expenses.where('itineraryItemId').equals(id).modify(expense => { delete expense.itineraryItemId })
    await db.items.delete(id)
    if (item?.parentId) await updateParentGroupFlags(item.parentId, undefined, now())
  })
}

export async function materializeTemplate(template: ActivityTemplate, dayId: string, cost?: LinkedCostInput, details?: MaterializeDetails): Promise<ItineraryItem> {
  validateStampDesign(template.stampKind)
  validateStampDesign(details?.stampKind)
  if (details && 'linkUrl' in details) details.linkUrl = normalizeItineraryLink(details.linkUrl)
  let createdItem!: ItineraryItem
  await db.transaction('rw', [db.places, db.items, db.expenses, db.days, db.rateSets], async () => {
    const createdAt = now()
    if (!await db.days.get(dayId)) throw new Error('The itinerary day does not exist.')
    if (template.stops.length === 1) {
      const stop = template.stops[0]
      let place = stop.placeId ? await db.places.get(stop.placeId) : undefined
      place ??= await db.places.filter(candidate => candidate.name === stop.placeName).first()
      if (!place) {
        place = { id: makeId(), name: stop.placeName, notes: template.description, wantToVisit: false, seeded: true, createdAt, updatedAt: createdAt }
        await db.places.add(place)
      }
      if (details) {
        place = {
          ...place,
          id: makeId(),
          name: details.name ?? place.name,
          address: details.address,
          googleMapsUrl: details.googleMapsUrl,
          wantToVisit: false,
          seeded: false,
          createdAt,
          updatedAt: createdAt,
        }
        await db.places.add(place)
      }
      createdItem = { id: makeId(), dayId, placeId: place.id, templateId: template.id, stampKind: details?.stampKind ?? template.stampKind, parentId: details?.parentId, time: details?.time, linkUrl: details?.linkUrl, bookingStatus: details?.bookingStatus, notes: details?.notes ?? (stop.notes.join(' · ') || undefined), visited: false, position: Date.now(), createdAt, updatedAt: createdAt }
      if (createdItem.parentId) await validateParentAssignment(createdItem.id, dayId, createdItem.parentId)
      await db.items.add(createdItem)
      if (createdItem.parentId) await db.items.update(createdItem.parentId, { isActivityGroup: true, updatedAt: createdAt })
      if (cost !== undefined) await addLinkedExpense(createdItem, cost, createdAt)
      return
    }

    const groupPlace: Place = {
      id: makeId(), name: details?.name ?? template.name, address: details?.address, googleMapsUrl: details?.googleMapsUrl, notes: details?.notes ?? template.description, wantToVisit: false,
      seeded: false, createdAt, updatedAt: createdAt,
    }
    const parent: ItineraryItem = {
      id: makeId(), dayId, placeId: groupPlace.id, templateId: template.id, isActivityGroup: true,
      stampKind: details?.stampKind ?? template.stampKind,
      time: details?.time, linkUrl: details?.linkUrl, bookingStatus: details?.bookingStatus, notes: details?.notes,
      visited: false, position: Date.now(), createdAt, updatedAt: createdAt,
    }
    await db.places.add(groupPlace)
    await db.items.add(parent)
    createdItem = parent
    for (const [index, stop] of template.stops.entries()) {
      let place = stop.placeId ? await db.places.get(stop.placeId) : undefined
      place ??= await db.places.filter(candidate => candidate.name === stop.placeName).first()
      if (!place) {
        place = { id: makeId(), name: stop.placeName, wantToVisit: false, seeded: true, createdAt, updatedAt: createdAt }
        await db.places.add(place)
      }
      const noteParts = [...stop.notes]
      if (stop.optional) noteParts.unshift('Optional')
      if (stop.approximateMinutes) noteParts.push(`Approx. ${stop.approximateMinutes >= 60 && stop.approximateMinutes % 60 === 0 ? `${stop.approximateMinutes / 60} hour` : `${stop.approximateMinutes} min`}`)
      await db.items.add({
        id: makeId(), dayId, placeId: place.id, parentId: parent.id, templateId: template.id,
        notes: noteParts.join(' · '), visited: false, position: index, createdAt, updatedAt: createdAt,
      })
    }
    if (cost !== undefined) await addLinkedExpense(parent, cost, createdAt)
  })
  return createdItem
}

export async function moveItineraryGroup(parentId: string, dayId: string) {
  await db.transaction('rw', db.items, async () => {
    await db.items.update(parentId, { dayId, updatedAt: now() })
    await db.items.where('parentId').equals(parentId).modify({ dayId, updatedAt: now() })
  })
}

export async function deleteItineraryGroup(parentId: string) {
  await db.transaction('rw', [db.items, db.places, db.stamps, db.expenses], async () => {
    const parent = await db.items.get(parentId)
    const children = await db.items.where('parentId').equals(parentId).toArray()
    const removedIds = [parentId, ...children.map(child => child.id)]
    for (const itemId of removedIds) {
      await refreshItemStampDesign(itemId)
      await db.stamps.where('itineraryItemId').equals(itemId).modify(memory => {
        delete memory.itineraryItemId
        memory.detached = true
      })
    }
    await db.expenses.where('itineraryItemId').anyOf(removedIds).modify(expense => { delete expense.itineraryItemId })
    await db.items.bulkDelete(removedIds)
    if (parent && await db.items.where('placeId').equals(parent.placeId).count() === 0) {
      await db.places.delete(parent.placeId)
    }
  })
}

export async function replaceAll(data: AppData) {
  validateNotebookStampDesigns(data)
  await db.transaction('rw', [db.trips, db.checklist, db.days, db.items, db.places, db.activityTemplates, db.expenses, db.stamps, db.photos, db.rateSets, db.metadata], async () => {
    await Promise.all([db.trips.clear(), db.checklist.clear(), db.days.clear(), db.items.clear(), db.places.clear(), db.activityTemplates.clear(), db.expenses.clear(), db.stamps.clear(), db.photos.clear(), db.rateSets.clear(), db.metadata.clear()])
    await db.trips.add(data.trip)
    await Promise.all([db.checklist.bulkAdd(data.checklist), db.days.bulkAdd(data.days), db.items.bulkAdd(data.items), db.places.bulkAdd(data.places), db.activityTemplates.bulkAdd(data.activityTemplates), db.expenses.bulkAdd(data.expenses), db.stamps.bulkAdd(data.stamps), db.photos.bulkAdd(data.photos), db.rateSets.bulkAdd(data.rateSets), db.metadata.bulkAdd(data.metadata)])
    await db.metadata.put({ key: 'schemaVersion', value: '4' })
  })
}

export async function refreshItemStampDesign(itemId: string) {
  const item = await db.items.get(itemId)
  if (!item) return
  const place = await db.places.get(item.placeId)
  await db.stamps.where('itineraryItemId').equals(itemId).modify({
    stampKind: item.stampKind ?? place?.stampKind ?? 'auto',
  })
}

export async function refreshPlaceStampDesigns(placeId: string) {
  for (const item of await db.items.where('placeId').equals(placeId).toArray()) {
    await refreshItemStampDesign(item.id)
  }
}
