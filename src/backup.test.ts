import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup } from './backup'
import type { AppData } from './types'

const data: AppData = {
  trip: { id:'current',destination:'Cape Town',travellers:2,startDate:'2026-09-21',endDate:'2026-09-28',timezone:'Africa/Johannesburg',notes:'',updatedAt:'2026-01-01T00:00:00Z' },
  checklist: [], days: [], items: [], places: [], activityTemplates: [], expenses: [], stamps: [], rateSets: [], metadata: [],
  photos: [{ id:'photo-1',stampId:'stamp-1',caption:'Ocean',mimeType:'image/jpeg',width:100,height:80,size:3,blob:new Blob(['abc'],{type:'image/jpeg'}),createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z' }],
}

describe('ZIP backup validation', () => {
  it('exports and restores actual photo bytes', async () => {
    const backup = await createBackup(data)
    const parsed = await parseBackup(new File([backup], 'backup.zip'))
    expect(parsed.photos[0].size).toBe(3)
    expect(await parsed.photos[0].blob.text()).toBe('abc')
  })

  it('rejects invalid versions before restore', async () => {
    const zip = new JSZip()
    zip.file('notebook.json', JSON.stringify({ schemaVersion: 99 }))
    const blob = await zip.generateAsync({ type:'blob' })
    await expect(parseBackup(new File([blob], 'bad.zip'))).rejects.toThrow('Unsupported backup version')
  })

  it('rejects malformed records even when the ZIP and JSON are readable', async () => {
    const zip = new JSZip()
    zip.file('notebook.json', JSON.stringify({
      schemaVersion: 2, trip: data.trip, checklist: [{ id: 4 }],
      days: [], items: [], places: [], activityTemplates: [], expenses: [], stamps: [], photos: [], rateSets: [], metadata: [],
    }))
    const blob = await zip.generateAsync({ type:'blob' })
    await expect(parseBackup(new File([blob], 'bad-record.zip'))).rejects.toThrow('checklist')
  })

  it('round-trips v4 itinerary expense links', async () => {
    const linked = { ...data, expenses: [{ id:'expense-1',amount:50,currency:'USD' as const,date:'2026-09-22',category:'Activity',itineraryItemId:'item-1',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z' }] }
    const blob = await createBackup(linked)
    const zip = await JSZip.loadAsync(blob)
    expect(JSON.parse(await zip.file('notebook.json')!.async('text')).schemaVersion).toBe(4)
    expect((await parseBackup(new File([blob], 'v4.zip'))).expenses[0].itineraryItemId).toBe('item-1')
  })

  it('restores a v3 backup without links and upgrades schema metadata', async () => {
    const zip = new JSZip()
    zip.file('notebook.json', JSON.stringify({
      schemaVersion:3, exportedAt:'2026-01-01T00:00:00Z', ...data,
      photos:[], expenses:[{ id:'legacy-expense',amount:20,currency:'KES',date:'2026-09-22',category:'Food',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z' }],
      metadata:[{ key:'schemaVersion',value:'3' }],
    }))
    const blob = await zip.generateAsync({ type:'blob' })
    const parsed = await parseBackup(new File([blob], 'v3.zip'))
    expect(parsed.expenses[0].itineraryItemId).toBeUndefined()
    expect(parsed.metadata.find(entry => entry.key === 'schemaVersion')?.value).toBe('4')
  })

  it('rejects a non-string v4 expense link', async () => {
    const zip = new JSZip()
    zip.file('notebook.json', JSON.stringify({
      schemaVersion:4, exportedAt:'2026-01-01T00:00:00Z', ...data, photos:[],
      expenses:[{ id:'expense-1',amount:20,currency:'KES',date:'2026-09-22',category:'Activity',itineraryItemId:42,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z' }],
    }))
    const blob = await zip.generateAsync({ type:'blob' })
    await expect(parseBackup(new File([blob], 'invalid-link.zip'))).rejects.toThrow('expenses')
  })

  it('rejects duplicate v4 expense links before restore', async () => {
    const zip = new JSZip()
    const expense = { amount:20,currency:'KES',date:'2026-09-22',category:'Activity',itineraryItemId:'item-1',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z' }
    zip.file('notebook.json', JSON.stringify({
      schemaVersion:4, exportedAt:'2026-01-01T00:00:00Z', ...data, photos:[],
      expenses:[{ ...expense, id:'expense-1' }, { ...expense, id:'expense-2' }],
    }))
    const blob = await zip.generateAsync({ type:'blob' })
    await expect(parseBackup(new File([blob], 'duplicate-link.zip'))).rejects.toThrow('more than one expense')
  })
})
