import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { db, deleteItineraryGroup, deleteItineraryItem, initializeDatabase, loadData, makeId, materializeTemplate, moveItineraryGroup, saveTrip } from './db'
import { compressPhoto } from './photo'
import type { ActivityTemplate, AppData, BookingStatus, ChecklistItem, Currency, Expense, ItineraryItem, Place, RateSet, Trip } from './types'
import './App.css'

type Tab = 'plan' | 'costs' | 'memories' | 'settings'
const timestamp = () => new Date().toISOString()
const formatDate = (date: string) => new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const money = (amount: number, currency: Currency) => new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
interface SectionProps { data: AppData; commit: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>; busy: boolean }

function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')].filter(element => !element.hasAttribute('disabled'))
      if (!focusable.length) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); returnFocusRef.current?.focus() }
  }, [open])
  if (!open) return null
  return <div className="sheet-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="sheet" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="sheet-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>×</button></div>
      {children}
    </section>
  </div>
}

async function hasCachedAppShell() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return false
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('Offline cache preparation timed out.')), 5000)),
  ])
  const names = await caches.keys()
  for (const name of names) {
    const requests = await (await caches.open(name)).keys()
    const paths = requests.map(request => new URL(request.url).pathname)
    if (paths.some(path => path.endsWith('/index.html')) && paths.some(path => /\/assets\/index-.*\.js$/.test(path)) && paths.some(path => /\/assets\/index-.*\.css$/.test(path))) return true
  }
  return false
}

export default function App() {
  const [data, setData] = useState<AppData>()
  const [tab, setTab] = useState<Tab>('plan')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [offlineStatus, setOfflineStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [restoreCandidate, setRestoreCandidate] = useState<AppData>()
  const refresh = async () => setData(await loadData())

  useEffect(() => {
    initializeDatabase().then(refresh).catch(err => setError(String(err)))
    const checkOfflineCache = () => hasCachedAppShell()
      .then(ready => setOfflineStatus(ready ? 'ready' : 'unavailable'))
      .catch(() => setOfflineStatus('unavailable'))
    checkOfflineCache()
    const prepared = () => checkOfflineCache()
    window.addEventListener('offline-ready', prepared)
    return () => window.removeEventListener('offline-ready', prepared)
  }, [])

  const commit = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await operation()
      await refresh()
      if (success) setNotice(success)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved. Please retry.')
      return false
    } finally { setBusy(false) }
  }

  if (!data) return <main className="loading"><span className="stamp-mark">CT</span><p>Opening your notebook…</p>{error && <p role="alert">{error}</p>}</main>
  return <div className="app-shell">
    <header><div className="bo-kaap-strip" aria-hidden="true"><i/><i/><i/><i/></div><div className="trip-heading"><div><p className="eyebrow">Field notes · 2026</p><h1>{data.trip.destination}</h1><p>{data.trip.startDate} → {data.trip.endDate} · {data.trip.travellers} adults</p></div><span className={`cache-status ${offlineStatus}`}><i/>{offlineStatus === 'ready' ? 'Offline ready' : offlineStatus === 'unavailable' ? 'Offline cache unavailable' : 'Preparing offline cache'}</span></div></header>
    {(error || notice) && <div className={error ? 'message error' : 'message'} role={error ? 'alert' : 'status'}>{error || notice}<button onClick={() => { setError(''); setNotice('') }} aria-label="Dismiss">×</button></div>}
    <main>
      {tab === 'plan' && <Plan data={data} commit={commit} busy={busy} />}
      {tab === 'costs' && <Costs data={data} commit={commit} busy={busy} />}
      {tab === 'memories' && <Memories data={data} commit={commit} busy={busy} />}
      {tab === 'settings' && <Settings data={data} commit={commit} busy={busy} onExport={async () => {
        setBusy(true)
        try {
          const blob = await createBackup(data); const link = document.createElement('a')
          link.href = URL.createObjectURL(blob); link.download = `cape-town-notebook-${new Date().toISOString().slice(0, 10)}.zip`; link.click()
          URL.revokeObjectURL(link.href); setNotice('Backup ZIP created.')
        } catch (err) { setError(err instanceof Error ? err.message : 'Export failed.') } finally { setBusy(false) }
      }} onRestore={async file => {
        setError(''); setBusy(true)
        try { setRestoreCandidate(await parseBackup(file)) } catch (err) { setError(err instanceof Error ? err.message : 'Restore validation failed.') } finally { setBusy(false) }
      }} />}
    </main>
    <nav aria-label="Notebook sections">{([['plan','Plan','⌁'],['costs','Costs','◒'],['memories','Stamps','✦'],['settings','More','•••']] as const).map(([id,label,icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav>
    {restoreCandidate && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><p className="eyebrow">Validated backup</p><h2 id="restore-title">Replace this notebook?</h2><p>This will atomically replace all current trip data and photos. It cannot be undone unless you export first.</p><div className="actions"><button className="ghost" onClick={() => setRestoreCandidate(undefined)}>Cancel</button><button className="danger" onClick={async () => { const candidate = restoreCandidate; setRestoreCandidate(undefined); await commit(() => restoreBackup(candidate), 'Notebook restored.') }}>Replace everything</button></div></section></div>}
  </div>
}

function Plan(props: SectionProps) {
  const [view, setView] = useState<'itinerary'|'ideas'|'checklist'|'wishlist'>('itinerary')
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">Make it yours</p><h2>Trip planner</h2></div><span className="sun">☀</span></div><div className="segmented four">{(['itinerary','ideas','checklist','wishlist'] as const).map(id => <button key={id} onClick={() => setView(id)} className={view === id ? 'active' : ''}>{id === 'wishlist' ? 'Want to visit' : id}</button>)}</div>{view === 'itinerary' && <Itinerary {...props} />}{view === 'ideas' && <Ideas {...props} />}{view === 'checklist' && <Checklist {...props} />}{view === 'wishlist' && <Wishlist {...props} />}</section>
}

function Checklist({ data, commit, busy }: SectionProps) {
  const [editing, setEditing] = useState<ChecklistItem>()
  const [editorOpen, setEditorOpen] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const now = timestamp()
    const item: ChecklistItem = { id: editing?.id ?? makeId(), title: String(fd.get('title')), category: String(fd.get('category')), dueDate: String(fd.get('dueDate')) || undefined, note: String(fd.get('note')) || undefined, completed: editing?.completed ?? false, createdAt: editing?.createdAt ?? now, updatedAt: now }
    if (await commit(() => db.checklist.put(item), 'Checklist saved.')) { form.reset(); setEditing(undefined); setEditorOpen(false) }
  }
  const closeEditor = () => { setEditorOpen(false); setEditing(undefined) }
  return <div className="stack"><div className="surface-actions"><p>{data.checklist.filter(item => !item.completed).length} left to do</p><button onClick={() => { setEditing(undefined); setEditorOpen(true) }}>+ Add reminder</button></div>
    {[...data.checklist].sort((a,b) => Number(a.completed)-Number(b.completed)).map(item => <article className={`card checklist-item ${item.completed ? 'done' : ''}`} key={item.id}><button className="check" aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'} onClick={() => commit(() => db.checklist.update(item.id, { completed: !item.completed, updatedAt: timestamp() }))}>{item.completed ? '✓' : ''}</button><div><strong>{item.title}</strong><small>{item.category}{item.dueDate ? ` · Due ${item.dueDate}` : ''}</small>{item.note && <p>{item.note}</p>}<details className="more"><summary>More</summary><div><button onClick={() => { setEditing(item); setEditorOpen(true) }}>Edit</button><button onClick={() => confirm('Delete this checklist item?') && commit(() => db.checklist.delete(item.id))}>Delete</button></div></details></div></article>)}
    <Sheet open={editorOpen} title={editing ? 'Edit reminder' : 'Add a reminder'} onClose={closeEditor}><form className="form-card" onSubmit={submit}><label>Task<input name="title" required defaultValue={editing?.title} /></label><div className="two"><label>Category<input name="category" required defaultValue={editing?.category ?? 'Planning'} /></label><label>Due date<input name="dueDate" type="date" defaultValue={editing?.dueDate} /></label></div><label>Note<textarea name="note" defaultValue={editing?.note} /></label><div className="actions"><button type="button" className="ghost" onClick={closeEditor}>Cancel</button><button disabled={busy}>Save reminder</button></div></form></Sheet>
  </div>
}

function PlaceForm({ onSave, dayId, onSaved, onCancel }: { onSave: (place: Place, item?: ItineraryItem) => Promise<boolean>; dayId?: string; onSaved?: () => void; onCancel?: () => void }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const now = timestamp(); const placeId = makeId()
    const place: Place = { id: placeId, name: String(fd.get('name')), address: String(fd.get('address')) || undefined, googleMapsUrl: String(fd.get('maps')) || undefined, wantToVisit: !dayId, createdAt: now, updatedAt: now }
    const item = dayId ? { id: makeId(), dayId, placeId, time: String(fd.get('time')) || undefined, notes: String(fd.get('notes')) || undefined, bookingStatus: (String(fd.get('status')) || undefined) as BookingStatus | undefined, visited: false, position: Date.now(), createdAt: now, updatedAt: now } : undefined
    if (await onSave(place, item)) { form.reset(); onSaved?.() }
  }
  return <form className="form-card" onSubmit={submit}><label>Place<input name="name" required placeholder="Add your own plan" /></label>{dayId && <div className="two"><label>Time<input name="time" type="time" /></label><label>Status<select name="status" defaultValue=""><option value="">Not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(x => <option key={x}>{x}</option>)}</select></label></div>}<label>Address<input name="address" /></label><label>Google Maps URL<input name="maps" type="url" /></label>{dayId && <label>Notes<textarea name="notes" /></label>}<div className="actions">{onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}<button>Add to {dayId ? 'day' : 'Want to visit'}</button></div></form>
}

function Itinerary({ data, commit, busy }: SectionProps) {
  const [openDay, setOpenDay] = useState(data.days.find(d => !d.outOfRange)?.id ?? data.days[0]?.id)
  const [addOpen, setAddOpen] = useState(false)
  const day = data.days.find(d => d.id === openDay)
  const dayItems = data.items.filter(i => i.dayId === openDay)
  const items = dayItems.filter(item => !item.parentId).sort((a,b) => a.position-b.position)
  const savePlace = (place: Place, item?: ItineraryItem) => commit(() => db.transaction('rw', [db.places,db.items], async () => { await db.places.put(place); if (item) await db.items.put(item) }), 'Itinerary saved.')
  const move = (item: ItineraryItem, direction: -1|1) => {
    const index = items.findIndex(i => i.id === item.id); const swap = items[index + direction]; if (!swap) return
    commit(() => db.transaction('rw', db.items, async () => { await db.items.update(item.id,{position:swap.position}); await db.items.update(swap.id,{position:item.position}) }))
  }
  const visited = (item: ItineraryItem, place: Place) => commit(() => db.transaction('rw', [db.items,db.stamps,db.photos], async () => {
    if (item.visited) {
      const stamp = await db.stamps.where('itineraryItemId').equals(item.id).first()
      if (stamp) await db.photos.where('stampId').equals(stamp.id).delete()
      await db.stamps.where('itineraryItemId').equals(item.id).delete()
      await db.items.update(item.id,{visited:false,updatedAt:timestamp()})
    }
    else { await db.stamps.add({id:makeId(),itineraryItemId:item.id,placeName:place.name,visitDate:day!.date,detached:false,createdAt:timestamp()}); await db.items.update(item.id,{visited:true,updatedAt:timestamp()}) }
  }), item.visited ? 'Visit undone.' : 'Stamp added.')
  return <div className="stack"><div className="surface-actions"><div className="date-strip">{data.days.map(d => <button key={d.id} className={`${openDay === d.id ? 'active' : ''} ${d.outOfRange ? 'flagged' : ''}`} onClick={() => setOpenDay(d.id)}><small>{formatDate(d.date).split(' ')[0]}</small><strong>{d.date.slice(-2)}</strong>{d.outOfRange && <span>!</span>}</button>)}</div><button className="add-action" onClick={() => setAddOpen(true)}>+ Add place</button></div>{day?.outOfRange && <p className="warning">This existing day falls outside the current trip dates. Move or remove its items when ready.</p>}
    {items.map((item,index) => {
      const place = data.places.find(candidate => candidate.id === item.placeId)!
      if (item.isActivityGroup) {
        const children = dayItems.filter(child => child.parentId === item.id).sort((a,b) => a.position-b.position)
        const visitedCount = children.filter(child => child.visited).length
        return <article className="card itinerary-group" key={item.id}>
          <div className="group-heading"><div><p className="eyebrow">Activity route</p><h3>{place.name}</h3><p>{children.length} stops · {visitedCount} visited</p></div>{item.bookingStatus && <span className="tag">{item.bookingStatus}</span>}</div>
          <details className="tour-stops"><summary><span>View route stops</span><strong>{visitedCount}/{children.length}</strong></summary><ol>{children.map(child => {
            const childPlace = data.places.find(candidate => candidate.id === child.placeId)!
            return <li className={child.visited ? 'stop-visited' : ''} key={child.id}><div className="stop-copy"><strong>{childPlace.name}</strong>{child.notes && <small>{child.notes}</small>}{child.visited && <small className="photo-hint">Stamp created · add a photo in Stamps</small>}</div><div className="stop-actions">{childPlace.googleMapsUrl && <a href={childPlace.googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${childPlace.name} in Google Maps`}>Map ↗</a>}<button className={child.visited ? 'visited' : ''} onClick={() => visited(child,childPlace)}>{child.visited ? 'Undo visited' : 'Visit + stamp'}</button></div></li>
          })}</ol></details>
          <details className="more itinerary-more"><summary>More</summary><div className="more-panel"><div className="group-controls"><label>Time<input aria-label={`Time for ${place.name}`} type="time" value={item.time ?? ''} onChange={event => commit(() => db.items.update(item.id,{time:event.target.value||undefined,updatedAt:timestamp()}))}/></label><label>Status<select aria-label={`Booking status for ${place.name}`} value={item.bookingStatus ?? ''} onChange={event => commit(() => db.items.update(item.id,{bookingStatus:(event.target.value||undefined) as BookingStatus|undefined,updatedAt:timestamp()}))}><option value="">Status not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(status=><option key={status}>{status}</option>)}</select></label></div><div className="item-actions"><button disabled={index===0||busy} onClick={() => move(item,-1)}>↑ Earlier</button><button disabled={index===items.length-1||busy} onClick={() => move(item,1)}>↓ Later</button><select aria-label={`Move ${place.name} to day`} value={item.dayId} onChange={event => commit(() => moveItineraryGroup(item.id,event.target.value), 'Activity moved with all stops.')}>{data.days.map(targetDay => <option key={targetDay.id} value={targetDay.id}>{targetDay.date}</option>)}</select><button onClick={() => confirm(`Delete ${place.name}? Visited stop stamps and photos will remain as detached memories.`) && commit(() => deleteItineraryGroup(item.id), 'Activity deleted; visited memories preserved.')}>Delete</button></div></div></details>
        </article>
      }
      return <article className="card itinerary-item" key={item.id}><div className="time">{item.time || 'Any time'}</div><div className="itinerary-body"><div className="row"><h3>{place?.name}</h3>{item.bookingStatus && <span className="tag">{item.bookingStatus}</span>}</div>{place?.address && <p>{place.address}</p>}{item.notes && <p>{item.notes}</p>}<div className="primary-actions">{place?.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps ↗</a>}<button className={item.visited ? 'visited' : ''} onClick={() => visited(item,place)}>{item.visited ? 'Undo visited' : 'Mark visited'}</button></div><details className="more itinerary-more"><summary>More</summary><div className="more-panel"><div className="group-controls"><label>Time<input aria-label={`Time for ${place.name}`} type="time" value={item.time ?? ''} onChange={e => commit(() => db.items.update(item.id,{time:e.target.value||undefined,updatedAt:timestamp()}))}/></label><label>Status<select aria-label={`Booking status for ${place.name}`} value={item.bookingStatus ?? ''} onChange={e => commit(() => db.items.update(item.id,{bookingStatus:(e.target.value||undefined) as BookingStatus|undefined,updatedAt:timestamp()}))}><option value="">Status not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(x=><option key={x}>{x}</option>)}</select></label></div><div className="item-actions"><button disabled={index===0||busy} onClick={() => move(item,-1)}>↑ Earlier</button><button disabled={index===items.length-1||busy} onClick={() => move(item,1)}>↓ Later</button><select aria-label="Move to day" value={item.dayId} onChange={e => commit(() => db.items.update(item.id,{dayId:e.target.value,updatedAt:timestamp()}))}>{data.days.map(d => <option key={d.id} value={d.id}>{d.date}</option>)}</select><button onClick={() => confirm('Delete this itinerary item? Its stamp becomes a detached memory.') && commit(() => deleteItineraryItem(item.id))}>Delete</button></div></div></details></div></article>
    })}
    {day && <Sheet open={addOpen} title={`Add to ${formatDate(day.date)}`} onClose={() => setAddOpen(false)}><PlaceForm dayId={day.id} onSave={savePlace} onSaved={() => setAddOpen(false)} onCancel={() => setAddOpen(false)}/></Sheet>}</div>
}

function Ideas({ data, commit, busy }: SectionProps) {
  const [editingPlace, setEditingPlace] = useState<string>()
  const [editingTemplate, setEditingTemplate] = useState<string>()
  const [scheduling, setScheduling] = useState<string>()
  const [scheduleDay, setScheduleDay] = useState('')
  const schedulePlace = (place: Place, dayId: string) => commit(() => db.items.add({
    id: makeId(), dayId, placeId: place.id, visited: false, position: Date.now(), createdAt: timestamp(), updatedAt: timestamp(),
  }), `${place.name} added to the itinerary.`)
  const deletePlace = (place: Place) => commit(() => db.transaction('rw', [db.places, db.items], async () => {
    if (await db.items.where('placeId').equals(place.id).count()) throw new Error('Remove this place from the itinerary before deleting it from Ideas.')
    await db.places.delete(place.id)
  }), 'Place deleted.')
  const materialize = (template: ActivityTemplate, dayId: string) => commit(
    () => materializeTemplate(template, dayId),
    template.stops.length > 1 ? `${template.name} added as one itinerary activity with ${template.stops.length} stops.` : `${template.name} added to the itinerary.`,
  )
  const templateToWishlist = (template: ActivityTemplate) => {
    const id = `template-wishlist-${template.id}`
    return commit(() => db.places.put({
      id, name: template.name, notes: template.description, wantToVisit: true, seeded: true,
      createdAt: timestamp(), updatedAt: timestamp(),
    }), `${template.name} added to Want to visit.`)
  }
  return <div className="stack">
    <div className="idea-intro"><p className="eyebrow">Planning library</p><p>Nothing here is booked or scheduled. Add a place to a day or save it to Want to visit when it earns a spot.</p></div>
    <h3 className="subheading">Activity templates</h3>
    {data.activityTemplates.map(template => <article className="card template-card" key={template.id}>
      {editingTemplate === template.id ? <form className="form-card" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form)
        if (await commit(() => db.activityTemplates.update(template.id, { name: String(fd.get('name')), description: String(fd.get('description')), updatedAt: timestamp() }), 'Template updated.')) setEditingTemplate(undefined)
      }}><label>Name<input name="name" required defaultValue={template.name}/></label><label>Description<textarea name="description" defaultValue={template.description}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingTemplate(undefined)}>Cancel</button><button>Save template</button></div></form> : <>
        <div className="row"><div><p className="eyebrow">Reusable template</p><h3>{template.name}</h3></div><span className="tag">{template.stops.length} {template.stops.length === 1 ? 'stop' : 'stops'}</span></div><p>{template.description}</p>
        <details className="route-details"><summary>{template.stops.length > 1 ? `View ${template.stops.length}-stop route` : 'View activity details'}</summary><ol className="template-stops">{template.stops.map(stop => <li key={stop.id}><strong>{stop.placeName}</strong>{stop.optional && <span className="tag">Optional</span>}<small>{[...stop.notes, stop.approximateMinutes ? `Approx. ${stop.approximateMinutes >= 60 && stop.approximateMinutes % 60 === 0 ? `${stop.approximateMinutes / 60} hour` : `${stop.approximateMinutes} min`}` : ''].filter(Boolean).join(' · ')}</small></li>)}</ol></details>
        <div className="primary-actions"><button aria-expanded={scheduling === template.id} aria-controls={`schedule-${template.id}`} onClick={() => { setScheduling(scheduling === template.id ? undefined : template.id); setScheduleDay('') }}>Add to day</button><button className="ghost" onClick={() => templateToWishlist(template)}>Want to visit</button></div>
        {scheduling === template.id && <div className="schedule-disclosure" id={`schedule-${template.id}`}><label>Choose a day<select value={scheduleDay} aria-label={`Day for ${template.name}`} onChange={event => setScheduleDay(event.target.value)}><option value="">Select a date…</option>{data.days.map(day => <option key={day.id} value={day.id}>{day.date}</option>)}</select></label><button disabled={!scheduleDay || busy} onClick={async () => { if (await materialize(template, scheduleDay)) { setScheduling(undefined); setScheduleDay('') } }}>Add activity</button></div>}
        <details className="more"><summary>More</summary><div className="more-panel"><button onClick={() => setEditingTemplate(template.id)}>Edit template</button><button disabled={busy} onClick={() => confirm(`Delete the ${template.name} template? Existing itinerary items will remain.`) && commit(() => db.activityTemplates.delete(template.id), 'Template deleted.')}>Delete template</button></div></details>
      </>}
    </article>)}
    <h3 className="subheading">Places</h3>
    <div className="place-grid">{data.places.filter(place => place.seeded && !place.id.startsWith('template-wishlist-')).map(place => <article className="card place-card" key={place.id}>
      {editingPlace === place.id ? <form className="form-card" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form)
        if (await commit(() => db.places.update(place.id, { name: String(fd.get('name')), googleMapsUrl: String(fd.get('maps')) || undefined, notes: String(fd.get('notes')) || undefined, updatedAt: timestamp() }), 'Place updated.')) setEditingPlace(undefined)
      }}><label>Name<input name="name" required defaultValue={place.name}/></label><label>Google Maps URL<input name="maps" type="url" defaultValue={place.googleMapsUrl}/></label><label>Notes<textarea name="notes" defaultValue={place.notes}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingPlace(undefined)}>Cancel</button><button>Save place</button></div></form> : <>
        <h3>{place.name}</h3>{place.notes && <p>{place.notes}</p>}<div className="primary-actions"><button aria-expanded={scheduling === place.id} aria-controls={`schedule-${place.id}`} onClick={() => { setScheduling(scheduling === place.id ? undefined : place.id); setScheduleDay('') }}>Add to day</button><button className="ghost" disabled={place.wantToVisit} onClick={() => commit(() => db.places.update(place.id, { wantToVisit: true, updatedAt: timestamp() }), 'Added to Want to visit.')}>{place.wantToVisit ? 'In Want to visit' : 'Want to visit'}</button></div>
        {scheduling === place.id && <div className="schedule-disclosure" id={`schedule-${place.id}`}><label>Choose a day<select value={scheduleDay} aria-label={`Day for ${place.name}`} onChange={event => setScheduleDay(event.target.value)}><option value="">Select a date…</option>{data.days.map(day => <option key={day.id} value={day.id}>{day.date}</option>)}</select></label><button disabled={!scheduleDay || busy} onClick={async () => { if (await schedulePlace(place, scheduleDay)) { setScheduling(undefined); setScheduleDay('') } }}>Add place</button></div>}
        <details className="more"><summary>More</summary><div className="more-panel">{place.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps ↗</a>}<button onClick={() => setEditingPlace(place.id)}>Edit place</button><button onClick={() => confirm(`Delete ${place.name} from the planning library?`) && deletePlace(place)}>Delete place</button></div></details>
      </>}
    </article>)}</div>
  </div>
}

function Wishlist({ data, commit }: SectionProps) {
  const [addOpen, setAddOpen] = useState(false)
  const places = data.places.filter(p => p.wantToVisit)
  const schedule = (place: Place, dayId: string) => commit(() => db.transaction('rw', [db.places,db.items], async () => { await db.items.add({id:makeId(),dayId,placeId:place.id,visited:false,position:Date.now(),createdAt:timestamp(),updatedAt:timestamp()}); await db.places.update(place.id,{wantToVisit:false,updatedAt:timestamp()}) }), 'Moved to itinerary.')
  return <div className="stack"><div className="surface-actions"><p>{places.length} saved {places.length === 1 ? 'place' : 'places'}</p><button onClick={() => setAddOpen(true)}>+ Add place</button></div>{places.map(place => <article className="card wishlist" key={place.id}><div><h3>{place.name}</h3>{place.address && <p>{place.address}</p>}<div className="primary-actions">{place.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps ↗</a>}<details className="more"><summary>Schedule</summary><div><select defaultValue="" aria-label={`Schedule ${place.name}`} onChange={e => e.target.value && schedule(place,e.target.value)}><option value="">Choose a day…</option>{data.days.map(d => <option value={d.id} key={d.id}>{d.date}</option>)}</select></div></details></div><details className="more"><summary>More</summary><div><button onClick={() => confirm('Remove this place?') && commit(() => db.places.delete(place.id))}>Delete</button></div></details></div></article>)}
    <Sheet open={addOpen} title="Add to Want to visit" onClose={() => setAddOpen(false)}><PlaceForm onSave={place => commit(() => db.places.put(place), 'Saved to Want to visit.')} onSaved={() => setAddOpen(false)} onCancel={() => setAddOpen(false)}/></Sheet>
  </div>
}

function Costs({ data, commit, busy }: SectionProps) {
  const [addOpen, setAddOpen] = useState(false)
  const displayCurrency = (data.metadata.find(m => m.key === 'displayCurrency')?.value ?? 'KES') as Currency
  const activeRates = data.rateSets.find(r => r.active)
  const totals = (['KES','USD','ZAR'] as Currency[]).map(currency => ({currency,amount:data.expenses.filter(e=>e.currency===currency).reduce((sum,e)=>sum+e.amount,0)}))
  const convert = (expense: Expense, target: Currency) => { const rates = data.rateSets.find(r => r.id === expense.rateSetId); if (!rates) return; const keys: Record<Currency,keyof RateSet> = {KES:'kesPerKes',USD:'kesPerUsd',ZAR:'kesPerZar'}; return expense.amount * Number(rates[keys[expense.currency]]) / Number(rates[keys[target]]) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const now=timestamp()
    const expense: Expense = {id:makeId(),amount:Number(fd.get('amount')),currency:String(fd.get('currency')) as Currency,date:String(fd.get('date')),category:String(fd.get('category')),note:String(fd.get('note'))||undefined,rateSetId:activeRates?.id,createdAt:now,updatedAt:now}
    if(await commit(()=>db.expenses.add(expense),'Expense saved.')) { form.reset(); setAddOpen(false) }
  }
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">Keep the original</p><h2>Trip costs</h2></div><select className="currency-switcher" aria-label="Display currency" value={displayCurrency} onChange={e=>commit(()=>db.metadata.put({key:'displayCurrency',value:e.target.value}))}>{['KES','USD','ZAR'].map(c=><option key={c}>{c}</option>)}</select></div><div className="totals">{totals.map(t=><div key={t.currency}><small>{t.currency}</small><strong>{money(t.amount,t.currency)}</strong></div>)}</div>{!activeRates && <p className="warning">Conversions are off. Review and activate a manual rate set in More. Original totals remain available.</p>}
    <div className="surface-actions"><p>{data.expenses.length} recorded {data.expenses.length === 1 ? 'expense' : 'expenses'}</p><button onClick={() => setAddOpen(true)}>+ Add expense</button></div>
    <div className="stack">{[...data.expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(expense=>{const equivalent=convert(expense,displayCurrency);return <article className="card expense" key={expense.id}><div><strong>{money(expense.amount,expense.currency)}</strong>{equivalent!==undefined&&expense.currency!==displayCurrency&&<small>≈ {money(equivalent,displayCurrency)} · recorded rate</small>}<p>{expense.category} · {expense.date}{expense.note?` · ${expense.note}`:''}</p></div><details className="more"><summary>More</summary><div><button onClick={()=>confirm('Delete this expense?')&&commit(()=>db.expenses.delete(expense.id))}>Delete</button></div></details></article>})}</div>
    <Sheet open={addOpen} title="Add an expense" onClose={() => setAddOpen(false)}><form className="form-card" onSubmit={submit}><div className="two"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Currency<select name="currency" defaultValue="KES">{['KES','USD','ZAR'].map(c=><option key={c}>{c}</option>)}</select></label></div><div className="two"><label>Date<input name="date" type="date" required defaultValue={data.trip.startDate}/></label><label>Category<input name="category" required placeholder="Food, transport…" /></label></div><label>Note<input name="note"/></label><div className="actions"><button type="button" className="ghost" onClick={() => setAddOpen(false)}>Cancel</button><button disabled={busy}>Save expense</button></div></form></Sheet>
  </section>
}

function Memories({ data, commit, busy }: SectionProps) {
  const [editingStampId, setEditingStampId] = useState<string>()
  const photoFor = (stampId:string)=>data.photos.find(p=>p.stampId===stampId)
  const editingStamp = data.stamps.find(stamp => stamp.id === editingStampId)
  const editingPhoto = editingStamp && photoFor(editingStamp.id)
  const savePhoto = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingStamp) return
    const form = event.currentTarget
    const input = form.elements.namedItem('photo') as HTMLInputElement
    const caption = (form.elements.namedItem('caption') as HTMLInputElement).value
    const file = input.files?.[0]
    if (!file && !editingPhoto) return
    try {
      const compressed = file ? await compressPhoto(file) : undefined
      const now = timestamp()
      const saved = await commit(() => db.photos.put({
        id: editingPhoto?.id ?? makeId(),
        stampId: editingStamp.id,
        caption,
        mimeType: compressed?.blob.type ?? editingPhoto!.mimeType,
        width: compressed?.width ?? editingPhoto!.width,
        height: compressed?.height ?? editingPhoto!.height,
        size: compressed?.blob.size ?? editingPhoto!.size,
        blob: compressed?.blob ?? editingPhoto!.blob,
        createdAt: editingPhoto?.createdAt ?? now,
        updatedAt: now,
      }), 'Memory saved.')
      if (saved) setEditingStampId(undefined)
    } catch (error) {
      await commit(() => Promise.reject(error))
    }
  }
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">Postcards to yourself</p><h2>Travel stamps</h2></div><span className="sun">✦</span></div>{!data.stamps.length&&<div className="empty"><span className="stamp-mark">CT</span><h3>Your passport is waiting</h3><p>Mark an itinerary item visited to make a stamp.</p></div>}<div className="memory-grid">{data.stamps.map(stamp=>{const photo=photoFor(stamp.id);return <article className="memory-card" key={stamp.id}>{photo?<img src={URL.createObjectURL(photo.blob)} alt={photo.caption||stamp.placeName}/>:<div className="stamp-art"><span>CAPE<br/>TOWN</span><i>✦</i><small>{stamp.visitDate}</small></div>}<div className="memory-copy"><p className="eyebrow">{stamp.detached?'Detached memory':'Visited'}</p><h3>{stamp.placeName}</h3><p>{formatDate(stamp.visitDate)}</p>{photo?.caption&&<p>{photo.caption}</p>}<button onClick={() => setEditingStampId(stamp.id)}>{photo ? 'Edit memory' : 'Add photo'}</button>
      {stamp.detached&&<details className="more danger-zone"><summary>Delete memory</summary><div><p>This permanently deletes this detached stamp and its photo.</p><button className="danger subtle" onClick={()=>confirm('Delete this memory and its photo permanently?')&&commit(()=>db.transaction('rw',[db.stamps,db.photos],async()=>{await db.photos.where('stampId').equals(stamp.id).delete();await db.stamps.delete(stamp.id)}))}>Delete permanently</button></div></details>}</div></article>})}</div>
    <Sheet open={Boolean(editingStamp)} title={editingPhoto ? `Edit ${editingStamp?.placeName}` : `Add a photo to ${editingStamp?.placeName ?? 'memory'}`} onClose={() => setEditingStampId(undefined)}><form className="form-card" onSubmit={savePhoto}><label>{editingPhoto ? 'Replacement photo (optional)' : 'Photo'}<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required={!editingPhoto}/></label><p className="form-hint">JPEG, PNG or WebP. Stored previews are compressed to a 1600px long edge and about 1 MB.</p><label>Caption<input name="caption" defaultValue={editingPhoto?.caption}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingStampId(undefined)}>Cancel</button><button disabled={busy}>{editingPhoto ? 'Save memory' : 'Add photo'}</button></div></form></Sheet>
  </section>
}

function Settings({ data, commit, busy, onExport, onRestore }: SectionProps & {onExport:()=>void;onRestore:(file:File)=>void}) {
  const [trip,setTrip]=useState<Trip>(data.trip)
  useEffect(()=>setTrip(data.trip),[data.trip])
  const example=data.rateSets[0]
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">The practical pages</p><h2>Notebook settings</h2></div></div>
    <details className="card settings-disclosure"><summary><span><strong>Trip details</strong><small>{data.trip.destination} · {formatDate(data.trip.startDate)}–{formatDate(data.trip.endDate)}</small></span></summary><form className="form-card" onSubmit={async e=>{e.preventDefault();await commit(()=>saveTrip(trip),'Trip updated.')}}><label>Destination<input value={trip.destination} onChange={e=>setTrip({...trip,destination:e.target.value})} required/></label><div className="two"><label>Start<input type="date" value={trip.startDate} onChange={e=>setTrip({...trip,startDate:e.target.value})} required/></label><label>End<input type="date" min={trip.startDate} value={trip.endDate} onChange={e=>setTrip({...trip,endDate:e.target.value})} required/></label></div><label>Adults<input type="number" min="1" value={trip.travellers} onChange={e=>setTrip({...trip,travellers:Number(e.target.value)})}/></label><label>Notes<textarea value={trip.notes} onChange={e=>setTrip({...trip,notes:e.target.value})}/></label><button disabled={busy}>Save trip</button></form></details>
    {example&&<details className="card settings-disclosure"><summary><span><strong>Manual exchange rates</strong><small>{data.rateSets.some(rate=>rate.active)?'A reviewed version is active':'Conversions are off · example rates only'}</small></span></summary><form className="form-card" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const fd=new FormData(form);await commit(()=>db.transaction('rw',db.rateSets,async()=>{await db.rateSets.toCollection().modify({active:false});await db.rateSets.add({id:makeId(),label:String(fd.get('label')),effectiveDate:String(fd.get('date')),kesPerKes:1,kesPerUsd:Number(fd.get('usd')),kesPerZar:Number(fd.get('zar')),active:true,example:false,createdAt:timestamp()})}),'New immutable rate version activated.')}}><p>Review these clearly labeled examples. Conversions stay disabled until you activate them. Each activation creates a new version, so old expenses never recalculate.</p><label>Label<input name="label" defaultValue="Reviewed manual rates"/></label><label>Effective date<input name="date" type="date" defaultValue={example.effectiveDate}/></label><div className="two"><label>KES per 1 USD<input name="usd" type="number" min="0.0001" step="0.0001" defaultValue={example.kesPerUsd}/></label><label>KES per 1 ZAR<input name="zar" type="number" min="0.0001" step="0.0001" defaultValue={example.kesPerZar}/></label></div><button disabled={busy}>Activate as new rate version</button></form></details>}
    <article className="card backup"><h3>Backup & restore</h3><p><strong>Privacy warning:</strong> exported ZIP files are unencrypted and contain your notebook plus actual stored photo files. Keep them somewhere private. Browser storage may be cleared or evicted.</p><div className="actions"><button onClick={onExport} disabled={busy}>Export ZIP</button><label className="file-button">Choose backup<input type="file" accept=".zip,application/zip" onChange={e=>e.target.files?.[0]&&onRestore(e.target.files[0])}/></label></div></article>
    <article className="card"><h3>Install & offline</h3><p>Use your browser’s Add to Home Screen or Install app action after deployment to a stable HTTPS origin. External Google Maps pages still need the internet.</p></article></section>
}
