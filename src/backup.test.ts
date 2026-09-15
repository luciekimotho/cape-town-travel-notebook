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
})
