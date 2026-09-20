import { describe, expect, it } from 'vitest'
import { currentItineraryState, millisecondsToNextMinute, zonedDateAndTime } from './currentItinerary'
import type { AppData, ItineraryItem } from './types'

const item = (id: string, time: string | undefined, position: number, extra: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id, dayId: '2026-09-21', placeId: `place-${id}`, time, position, visited: false,
  createdAt: '', updatedAt: '', ...extra,
})
const data = (items: ItineraryItem[], timezone = 'Africa/Johannesburg'): AppData => ({
  trip: { id: 'current', destination: 'Cape Town', travellers: 2, startDate: '2026-09-21', endDate: '2026-09-21', timezone, notes: '', updatedAt: '' },
  days: [{ id: '2026-09-21', date: '2026-09-21', outOfRange: false }],
  items,
  places: items.map(entry => ({ id: entry.placeId, name: entry.id, wantToVisit: false, createdAt: '', updatedAt: '' })),
  checklist: [], activityTemplates: [], expenses: [], stamps: [], photos: [], rateSets: [], metadata: [],
})

describe('Cape Town current itinerary activity', () => {
  it('has no current item before the first start, but identifies today', () => {
    expect(currentItineraryState(data([item('breakfast', '09:00', 1)]), new Date('2026-09-21T06:59:00Z')))
      .toMatchObject({ dayId: '2026-09-21', itemId: undefined, localTime: '08:59' })
  })

  it('keeps the latest started activity current until the exact next boundary', () => {
    const notebook = data([item('first', '09:00', 1), item('second', '11:30', 2)])
    expect(currentItineraryState(notebook, new Date('2026-09-21T08:00:00Z')).itemId).toBe('first')
    expect(currentItineraryState(notebook, new Date('2026-09-21T09:29:59Z')).itemId).toBe('first')
    expect(currentItineraryState(notebook, new Date('2026-09-21T09:30:00Z')).itemId).toBe('second')
    expect(currentItineraryState(notebook, new Date('2026-09-21T21:59:00Z')).itemId).toBe('second')
  })

  it('keeps the parent current and identifies the latest timed child', () => {
    const notebook = data([
      item('parent', '09:00', 1),
      item('child-first', '10:00', 2, { parentId: 'parent' }),
      item('child-second', '12:00', 3, { parentId: 'parent' }),
      item('untimed', undefined, 3),
      item('invalid', '25:00', 4),
    ])
    expect(currentItineraryState(notebook, new Date('2026-09-21T09:30:00Z')))
      .toMatchObject({ itemId: 'parent', childItemId: 'child-first' })
    expect(currentItineraryState(notebook, new Date('2026-09-21T10:00:00Z')))
      .toMatchObject({ itemId: 'parent', childItemId: 'child-second' })
  })

  it('does not mark future, untimed or invalid children current', () => {
    const notebook = data([
      item('parent', '09:00', 1),
      item('future', '12:00', 2, { parentId: 'parent' }),
      item('untimed-child', undefined, 3, { parentId: 'parent' }),
      item('invalid-child', '99:00', 4, { parentId: 'parent' }),
    ])
    expect(currentItineraryState(notebook, new Date('2026-09-21T07:30:00Z')))
      .toMatchObject({ itemId: 'parent', childItemId: undefined })
  })

  it('uses stable position order when activities share a start', () => {
    const notebook = data([item('later-position', '09:00', 20), item('first-position', '09:00', 10)])
    expect(currentItineraryState(notebook, new Date('2026-09-21T07:00:00Z')).itemId).toBe('first-position')
  })

  it('returns no current activity outside an itinerary day', () => {
    expect(currentItineraryState(data([item('first', '09:00', 1)]), new Date('2026-09-20T12:00:00Z')).itemId).toBeUndefined()
    expect(currentItineraryState(data([item('first', '09:00', 1)]), new Date('2026-09-22T00:00:00Z')).itemId).toBeUndefined()
  })

  it('uses the IANA timezone rather than the device timezone', () => {
    const instant = new Date('2026-09-20T22:30:00Z')
    expect(zonedDateAndTime(instant, 'Africa/Johannesburg')).toEqual({ date: '2026-09-21', time: '00:30' })
    expect(zonedDateAndTime(instant, 'America/Los_Angeles')).toEqual({ date: '2026-09-20', time: '15:30' })
    expect(currentItineraryState(data([item('midnight', '00:15', 1)]), instant).itemId).toBe('midnight')
  })

  it('uses an explicit day timezone for a pre-trip departure day', () => {
    const notebook = data([item('packing', '18:30', 1)])
    notebook.days[0] = { id: '2026-09-20', date: '2026-09-20', outOfRange: false }
    notebook.items[0].dayId = '2026-09-20'
    notebook.metadata.push({ key: 'day.timezone.2026-09-20', value: 'Africa/Nairobi' })
    expect(currentItineraryState(notebook, new Date('2026-09-20T15:30:00Z')))
      .toMatchObject({ dayId: '2026-09-20', itemId: 'packing', localTime: '18:30' })
  })

  it('uses item timezones for a multi-timezone travel day', () => {
    const notebook = data([
      item('travel-day', '01:30', 1),
      item('boarding-et309', '01:30', 0, { parentId: 'travel-day' }),
      item('flight-et309', '03:00', 1, { parentId: 'travel-day' }),
      item('hotel-check-in', '15:00', 2, { parentId: 'travel-day' }),
    ])
    notebook.metadata.push(
      { key: 'item.timezone.travel-day', value: 'Africa/Nairobi' },
      { key: 'item.timezone.boarding-et309', value: 'Africa/Nairobi' },
      { key: 'item.timezone.flight-et309', value: 'Africa/Nairobi' },
    )
    expect(currentItineraryState(notebook, new Date('2026-09-20T22:40:00Z')))
      .toMatchObject({ dayId: '2026-09-21', itemId: 'travel-day', childItemId: 'boarding-et309' })
    expect(currentItineraryState(notebook, new Date('2026-09-21T13:30:00Z')))
      .toMatchObject({ itemId: 'travel-day', childItemId: 'hotel-check-in' })
  })

  it('keeps a daytime family activity current until evening preparations begin', () => {
    const notebook = data([
      item('kids', '13:30', 1),
      item('preparations', '18:30', 2),
    ])
    notebook.days[0] = { id: '2026-09-20', date: '2026-09-20', outOfRange: false }
    notebook.items.forEach(entry => { entry.dayId = '2026-09-20' })
    notebook.metadata.push({ key: 'day.timezone.2026-09-20', value: 'Africa/Nairobi' })
    expect(currentItineraryState(notebook, new Date('2026-09-20T10:41:00Z')).itemId).toBe('kids')
    expect(currentItineraryState(notebook, new Date('2026-09-20T15:30:00Z')).itemId).toBe('preparations')
  })

  it('fails safely for an invalid timezone or clock', () => {
    expect(currentItineraryState(data([], 'Not/AZone'), new Date())).toEqual({})
    expect(zonedDateAndTime(new Date('invalid'), 'Africa/Johannesburg')).toBeUndefined()
  })

  it('aligns refreshes to the next minute boundary without ticking each second', () => {
    expect(millisecondsToNextMinute(new Date('2026-09-22T08:59:10.000Z'))).toBe(50_010)
    expect(millisecondsToNextMinute(new Date('2026-09-22T09:00:00.000Z'))).toBe(60_010)
    expect(millisecondsToNextMinute(new Date('invalid'))).toBe(60_000)
  })
})
