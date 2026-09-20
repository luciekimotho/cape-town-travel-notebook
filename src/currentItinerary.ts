import type { AppData, ItineraryItem } from './types'

export interface CurrentItineraryState {
  dayId?: string
  itemId?: string
  childItemId?: string
  localDate?: string
  localTime?: string
}

export function millisecondsToNextMinute(now: Date): number {
  const value = now.getTime()
  if (!Number.isFinite(value)) return 60_000
  return 60_000 - ((value % 60_000) + 60_000) % 60_000 + 10
}

const validTime = (value?: string): value is string =>
  Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))

export function zonedDateAndTime(now: Date, timezone: string): { date: string; time: string } | undefined {
  if (!Number.isFinite(now.getTime())) return undefined
  try {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
    if (!values.year || !values.month || !values.day || !values.hour || !values.minute) return undefined
    return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
  } catch {
    return undefined
  }
}

function scheduledRoots(data: AppData, dayId: string): ItineraryItem[] {
  return data.items
    .filter(item => item.dayId === dayId && !item.parentId && validTime(item.time))
    .sort((left, right) =>
      left.time!.localeCompare(right.time!) ||
      left.position - right.position ||
      left.id.localeCompare(right.id))
}

function hasStarted(data: AppData, item: ItineraryItem, date: string, now: Date, fallbackTimezone: string): boolean {
  const timezone = data.metadata.find(entry => entry.key === `item.timezone.${item.id}`)?.value ?? fallbackTimezone
  const local = zonedDateAndTime(now, timezone)
  return Boolean(local && local.date === date && item.time! <= local.time)
}

export function currentItineraryState(data: AppData, now: Date): CurrentItineraryState {
  const overriddenDay = data.days.find(day => {
    const timezone = data.metadata.find(entry => entry.key === `day.timezone.${day.date}`)?.value
    return timezone && zonedDateAndTime(now, timezone)?.date === day.date
  })
  const timezone = overriddenDay
    ? data.metadata.find(entry => entry.key === `day.timezone.${overriddenDay.date}`)!.value
    : data.trip.timezone
  const local = zonedDateAndTime(now, timezone)
  if (!local) return {}
  const day = overriddenDay ?? data.days.find(candidate => candidate.date === local.date)
  if (!day) return { localDate: local.date, localTime: local.time }
  const roots = scheduledRoots(data, day.id)
  const latestTime = roots.filter(item => hasStarted(data, item, day.date, now, timezone)).at(-1)?.time
  // For identical starts, the first stable itinerary entry wins.
  const current = latestTime ? roots.find(item => item.time === latestTime) : undefined
  const children = current
    ? data.items
        .filter(item => item.parentId === current.id && item.dayId === day.id && validTime(item.time))
        .sort((left, right) =>
          left.time!.localeCompare(right.time!) ||
          left.position - right.position ||
          left.id.localeCompare(right.id))
    : []
  const latestChildTime = children.filter(item => hasStarted(data, item, day.date, now, timezone)).at(-1)?.time
  const currentChild = latestChildTime ? children.find(item => item.time === latestChildTime) : undefined
  return { dayId: day.id, itemId: current?.id, childItemId: currentChild?.id, localDate: local.date, localTime: local.time }
}
