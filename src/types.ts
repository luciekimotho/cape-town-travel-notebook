export type BookingStatus = 'Idea' | 'To book' | 'Booked' | 'Confirmed' | 'Cancelled'
export type Currency = 'KES' | 'USD' | 'ZAR'

export interface Trip { id: 'current'; destination: string; travellers: number; startDate: string; endDate: string; timezone: string; notes: string; updatedAt: string }
export interface ChecklistItem { id: string; title: string; category: string; dueDate?: string; completed: boolean; note?: string; createdAt: string; updatedAt: string }
export interface ItineraryDay { id: string; date: string; outOfRange: boolean }
export interface Place { id: string; name: string; address?: string; notes?: string; googleMapsUrl?: string; wantToVisit: boolean; seeded?: boolean; createdAt: string; updatedAt: string }
export interface ItineraryItem { id: string; dayId: string; placeId: string; time?: string; notes?: string; bookingStatus?: BookingStatus; visited: boolean; position: number; createdAt: string; updatedAt: string }
export interface ActivityTemplateStop { id: string; placeName: string; placeId?: string; notes: string[]; approximateMinutes?: number; optional?: boolean }
export interface ActivityTemplate { id: string; name: string; description: string; stops: ActivityTemplateStop[]; seeded: boolean; createdAt: string; updatedAt: string }
export interface RateSet { id: string; label: string; effectiveDate: string; kesPerKes: number; kesPerUsd: number; kesPerZar: number; active: boolean; example: boolean; createdAt: string }
export interface Expense { id: string; amount: number; currency: Currency; date: string; category: string; note?: string; rateSetId?: string; createdAt: string; updatedAt: string }
export interface TravelStamp { id: string; itineraryItemId?: string; placeName: string; visitDate: string; detached: boolean; createdAt: string }
export interface PhotoEntry { id: string; stampId: string; caption: string; mimeType: string; width: number; height: number; size: number; blob: Blob; createdAt: string; updatedAt: string }
export interface AppMetadata { key: string; value: string }
export interface AppData { trip: Trip; checklist: ChecklistItem[]; days: ItineraryDay[]; items: ItineraryItem[]; places: Place[]; activityTemplates: ActivityTemplate[]; expenses: Expense[]; stamps: TravelStamp[]; photos: PhotoEntry[]; rateSets: RateSet[]; metadata: AppMetadata[] }
export interface BackupData { schemaVersion: 2; exportedAt: string; trip: Trip; checklist: ChecklistItem[]; days: ItineraryDay[]; items: ItineraryItem[]; places: Place[]; activityTemplates: ActivityTemplate[]; expenses: Expense[]; stamps: TravelStamp[]; photos: Omit<PhotoEntry, 'blob'>[]; rateSets: RateSet[]; metadata: AppMetadata[] }
