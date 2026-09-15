import { useEffect, useState, type FormEvent } from 'react'
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

export default function App() {
  const [data, setData] = useState<AppData>()
  const [tab, setTab] = useState<Tab>('plan')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoreCandidate, setRestoreCandidate] = useState<AppData>()
  const refresh = async () => setData(await loadData())

  useEffect(() => {
    initializeDatabase().then(refresh).catch(err => setError(String(err)))
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
    <header><div><p className="eyebrow">Field notes · 2026</p><h1>{data.trip.destination}</h1><p>{data.trip.startDate} → {data.trip.endDate} · {data.trip.travellers} adults</p></div></header>
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
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const now = timestamp()
    const item: ChecklistItem = { id: editing?.id ?? makeId(), title: String(fd.get('title')), category: String(fd.get('category')), dueDate: String(fd.get('dueDate')) || undefined, note: String(fd.get('note')) || undefined, completed: editing?.completed ?? false, createdAt: editing?.createdAt ?? now, updatedAt: now }
    if (await commit(() => db.checklist.put(item), 'Checklist saved.')) { event.currentTarget.reset(); setEditing(undefined) }
  }
  return <div className="stack"><form className="card form-card" onSubmit={submit}><h3>{editing ? 'Edit checklist item' : 'Add a reminder'}</h3><label>Task<input name="title" required defaultValue={editing?.title} /></label><div className="two"><label>Category<input name="category" required defaultValue={editing?.category ?? 'Planning'} /></label><label>Due date<input name="dueDate" type="date" defaultValue={editing?.dueDate} /></label></div><label>Note<textarea name="note" defaultValue={editing?.note} /></label><div className="actions">{editing && <button type="button" className="ghost" onClick={() => setEditing(undefined)}>Cancel</button>}<button disabled={busy}>Save reminder</button></div></form>
    {[...data.checklist].sort((a,b) => Number(a.completed)-Number(b.completed)).map(item => <article className={`card checklist-item ${item.completed ? 'done' : ''}`} key={item.id}><button className="check" aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'} onClick={() => commit(() => db.checklist.update(item.id, { completed: !item.completed, updatedAt: timestamp() }))}>{item.completed ? '✓' : ''}</button><div><strong>{item.title}</strong><small>{item.category}{item.dueDate ? ` · Due ${item.dueDate}` : ''}</small>{item.note && <p>{item.note}</p>}</div><div className="item-actions"><button onClick={() => setEditing(item)}>Edit</button><button onClick={() => confirm('Delete this checklist item?') && commit(() => db.checklist.delete(item.id))}>Delete</button></div></article>)}</div>
}

function PlaceForm({ onSave, dayId }: { onSave: (place: Place, item?: ItineraryItem) => Promise<boolean>; dayId?: string }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const now = timestamp(); const placeId = makeId()
    const place: Place = { id: placeId, name: String(fd.get('name')), address: String(fd.get('address')) || undefined, googleMapsUrl: String(fd.get('maps')) || undefined, wantToVisit: !dayId, createdAt: now, updatedAt: now }
    const item = dayId ? { id: makeId(), dayId, placeId, time: String(fd.get('time')) || undefined, notes: String(fd.get('notes')) || undefined, bookingStatus: (String(fd.get('status')) || undefined) as BookingStatus | undefined, visited: false, position: Date.now(), createdAt: now, updatedAt: now } : undefined
    if (await onSave(place, item)) event.currentTarget.reset()
  }
  return <form className="card form-card compact" onSubmit={submit}><label>Place<input name="name" required placeholder="Add your own plan" /></label>{dayId && <div className="two"><label>Time<input name="time" type="time" /></label><label>Status<select name="status" defaultValue=""><option value="">Not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(x => <option key={x}>{x}</option>)}</select></label></div>}<label>Address<input name="address" /></label><label>Google Maps URL<input name="maps" type="url" /></label>{dayId && <label>Notes<textarea name="notes" /></label>}<button>Add to {dayId ? 'day' : 'Want to visit'}</button></form>
}

function Itinerary({ data, commit, busy }: SectionProps) {
  const [openDay, setOpenDay] = useState(data.days.find(d => !d.outOfRange)?.id ?? data.days[0]?.id)
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
  return <div className="stack"><div className="date-strip">{data.days.map(d => <button key={d.id} className={`${openDay === d.id ? 'active' : ''} ${d.outOfRange ? 'flagged' : ''}`} onClick={() => setOpenDay(d.id)}><small>{formatDate(d.date).split(' ')[0]}</small><strong>{d.date.slice(-2)}</strong>{d.outOfRange && <span>!</span>}</button>)}</div>{day?.outOfRange && <p className="warning">This existing day falls outside the current trip dates. Move or remove its items when ready.</p>}
    {items.map((item,index) => {
      const place = data.places.find(candidate => candidate.id === item.placeId)!
      if (item.isActivityGroup) {
        const children = dayItems.filter(child => child.parentId === item.id).sort((a,b) => a.position-b.position)
        const visitedCount = children.filter(child => child.visited).length
        return <article className="card itinerary-group" key={item.id}>
          <div className="group-heading"><div><p className="eyebrow">Activity route</p><h3>{place.name}</h3><p>{children.length} stops · {visitedCount} visited</p></div>{item.bookingStatus && <span className="tag">{item.bookingStatus}</span>}</div>
          <div className="group-controls"><input aria-label={`Time for ${place.name}`} type="time" value={item.time ?? ''} onChange={event => commit(() => db.items.update(item.id,{time:event.target.value||undefined,updatedAt:timestamp()}))}/><select aria-label={`Booking status for ${place.name}`} value={item.bookingStatus ?? ''} onChange={event => commit(() => db.items.update(item.id,{bookingStatus:(event.target.value||undefined) as BookingStatus|undefined,updatedAt:timestamp()}))}><option value="">Status not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(status=><option key={status}>{status}</option>)}</select></div>
          <details className="tour-stops"><summary><span>View route stops</span><strong>{visitedCount}/{children.length}</strong></summary><ol>{children.map(child => {
            const childPlace = data.places.find(candidate => candidate.id === child.placeId)!
            return <li className={child.visited ? 'stop-visited' : ''} key={child.id}><div className="stop-copy"><strong>{childPlace.name}</strong>{child.notes && <small>{child.notes}</small>}{child.visited && <small className="photo-hint">Stamp created · add a photo in Stamps</small>}</div><div className="stop-actions">{childPlace.googleMapsUrl && <a href={childPlace.googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${childPlace.name} in Google Maps`}>Map ↗</a>}<button className={child.visited ? 'visited' : ''} onClick={() => visited(child,childPlace)}>{child.visited ? 'Undo visited' : 'Visit + stamp'}</button></div></li>
          })}</ol></details>
          <div className="item-actions"><button disabled={index===0||busy} onClick={() => move(item,-1)}>↑ Earlier</button><button disabled={index===items.length-1||busy} onClick={() => move(item,1)}>↓ Later</button><select aria-label={`Move ${place.name} to day`} value={item.dayId} onChange={event => commit(() => moveItineraryGroup(item.id,event.target.value), 'Activity moved with all stops.')}>{data.days.map(targetDay => <option key={targetDay.id} value={targetDay.id}>{targetDay.date}</option>)}</select><button onClick={() => confirm(`Delete ${place.name}? Visited stop stamps and photos will remain as detached memories.`) && commit(() => deleteItineraryGroup(item.id), 'Activity deleted; visited memories preserved.')}>Delete</button></div>
        </article>
      }
      return <article className="card itinerary-item" key={item.id}><div className="time">{item.time || 'Any time'}</div><div className="itinerary-body"><div className="row"><h3>{place?.name}</h3>{item.bookingStatus && <span className="tag">{item.bookingStatus}</span>}</div>{place?.address && <p>{place.address}</p>}{item.notes && <p>{item.notes}</p>}<div className="item-actions"><input aria-label={`Time for ${place.name}`} type="time" value={item.time ?? ''} onChange={e => commit(() => db.items.update(item.id,{time:e.target.value||undefined,updatedAt:timestamp()}))}/><select aria-label={`Booking status for ${place.name}`} value={item.bookingStatus ?? ''} onChange={e => commit(() => db.items.update(item.id,{bookingStatus:(e.target.value||undefined) as BookingStatus|undefined,updatedAt:timestamp()}))}><option value="">Status not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(x=><option key={x}>{x}</option>)}</select><button disabled={index===0||busy} onClick={() => move(item,-1)}>↑ Earlier</button><button disabled={index===items.length-1||busy} onClick={() => move(item,1)}>↓ Later</button><select aria-label="Move to day" value={item.dayId} onChange={e => commit(() => db.items.update(item.id,{dayId:e.target.value,updatedAt:timestamp()}))}>{data.days.map(d => <option key={d.id} value={d.id}>{d.date}</option>)}</select>{place?.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps ↗</a>}<button className={item.visited ? 'visited' : ''} onClick={() => visited(item,place)}>{item.visited ? 'Undo visited' : 'Mark visited'}</button><button onClick={() => confirm('Delete this itinerary item? Its stamp becomes a detached memory.') && commit(() => deleteItineraryItem(item.id))}>Delete</button></div></div></article>
    })}
    {day && <PlaceForm dayId={day.id} onSave={savePlace} />}</div>
}

function Ideas({ data, commit, busy }: SectionProps) {
  const [editingPlace, setEditingPlace] = useState<string>()
  const [editingTemplate, setEditingTemplate] = useState<string>()
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
        event.preventDefault(); const fd = new FormData(event.currentTarget)
        if (await commit(() => db.activityTemplates.update(template.id, { name: String(fd.get('name')), description: String(fd.get('description')), updatedAt: timestamp() }), 'Template updated.')) setEditingTemplate(undefined)
      }}><label>Name<input name="name" required defaultValue={template.name}/></label><label>Description<textarea name="description" defaultValue={template.description}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingTemplate(undefined)}>Cancel</button><button>Save template</button></div></form> : <>
        <div className="row"><div><p className="eyebrow">Reusable template</p><h3>{template.name}</h3></div><span className="tag">{template.stops.length} {template.stops.length === 1 ? 'stop' : 'stops'}</span></div><p>{template.description}</p>
        <ol className="template-stops">{template.stops.map(stop => <li key={stop.id}><strong>{stop.placeName}</strong>{stop.optional && <span className="tag">Optional</span>}<small>{[...stop.notes, stop.approximateMinutes ? `Approx. ${stop.approximateMinutes >= 60 && stop.approximateMinutes % 60 === 0 ? `${stop.approximateMinutes / 60} hour` : `${stop.approximateMinutes} min`}` : ''].filter(Boolean).join(' · ')}</small></li>)}</ol>
        <div className="item-actions"><select defaultValue="" aria-label={`Add ${template.name} to a day`} onChange={event => { if (event.target.value) materialize(template, event.target.value); event.target.value = '' }}><option value="">Add template to day…</option>{data.days.map(day => <option key={day.id} value={day.id}>{day.date}</option>)}</select><button onClick={() => templateToWishlist(template)}>Want to visit</button><button onClick={() => setEditingTemplate(template.id)}>Edit</button><button disabled={busy} onClick={() => confirm(`Delete the ${template.name} template? Existing itinerary items will remain.`) && commit(() => db.activityTemplates.delete(template.id), 'Template deleted.')}>Delete</button></div>
      </>}
    </article>)}
    <h3 className="subheading">Places</h3>
    <div className="place-grid">{data.places.filter(place => place.seeded && !place.id.startsWith('template-wishlist-')).map(place => <article className="card place-card" key={place.id}>
      {editingPlace === place.id ? <form className="form-card" onSubmit={async event => {
        event.preventDefault(); const fd = new FormData(event.currentTarget)
        if (await commit(() => db.places.update(place.id, { name: String(fd.get('name')), googleMapsUrl: String(fd.get('maps')) || undefined, notes: String(fd.get('notes')) || undefined, updatedAt: timestamp() }), 'Place updated.')) setEditingPlace(undefined)
      }}><label>Name<input name="name" required defaultValue={place.name}/></label><label>Google Maps URL<input name="maps" type="url" defaultValue={place.googleMapsUrl}/></label><label>Notes<textarea name="notes" defaultValue={place.notes}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingPlace(undefined)}>Cancel</button><button>Save place</button></div></form> : <>
        <h3>{place.name}</h3>{place.notes && <p>{place.notes}</p>}<div className="item-actions"><select defaultValue="" aria-label={`Add ${place.name} to a day`} onChange={event => { if (event.target.value) schedulePlace(place, event.target.value); event.target.value = '' }}><option value="">Add to day…</option>{data.days.map(day => <option key={day.id} value={day.id}>{day.date}</option>)}</select><button disabled={place.wantToVisit} onClick={() => commit(() => db.places.update(place.id, { wantToVisit: true, updatedAt: timestamp() }), 'Added to Want to visit.')}>{place.wantToVisit ? 'In Want to visit' : 'Want to visit'}</button>{place.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Maps ↗</a>}<button onClick={() => setEditingPlace(place.id)}>Edit</button><button onClick={() => confirm(`Delete ${place.name} from the planning library?`) && deletePlace(place)}>Delete</button></div>
      </>}
    </article>)}</div>
  </div>
}

function Wishlist({ data, commit }: SectionProps) {
  const places = data.places.filter(p => p.wantToVisit)
  const schedule = (place: Place, dayId: string) => commit(() => db.transaction('rw', [db.places,db.items], async () => { await db.items.add({id:makeId(),dayId,placeId:place.id,visited:false,position:Date.now(),createdAt:timestamp(),updatedAt:timestamp()}); await db.places.update(place.id,{wantToVisit:false,updatedAt:timestamp()}) }), 'Moved to itinerary.')
  return <div className="stack">{places.map(place => <article className="card wishlist" key={place.id}><div><h3>{place.name}</h3>{place.address && <p>{place.address}</p>}</div><div className="item-actions">{place.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Google Maps ↗</a>}<select defaultValue="" aria-label={`Schedule ${place.name}`} onChange={e => e.target.value && schedule(place,e.target.value)}><option value="">Schedule…</option>{data.days.map(d => <option value={d.id} key={d.id}>{d.date}</option>)}</select><button onClick={() => confirm('Remove this place?') && commit(() => db.places.delete(place.id))}>Delete</button></div></article>)}<PlaceForm onSave={place => commit(() => db.places.put(place), 'Saved to Want to visit.')} /></div>
}

function Costs({ data, commit, busy }: SectionProps) {
  const displayCurrency = (data.metadata.find(m => m.key === 'displayCurrency')?.value ?? 'KES') as Currency
  const activeRates = data.rateSets.find(r => r.active)
  const totals = (['KES','USD','ZAR'] as Currency[]).map(currency => ({currency,amount:data.expenses.filter(e=>e.currency===currency).reduce((sum,e)=>sum+e.amount,0)}))
  const convert = (expense: Expense, target: Currency) => { const rates = data.rateSets.find(r => r.id === expense.rateSetId); if (!rates) return; const keys: Record<Currency,keyof RateSet> = {KES:'kesPerKes',USD:'kesPerUsd',ZAR:'kesPerZar'}; return expense.amount * Number(rates[keys[expense.currency]]) / Number(rates[keys[target]]) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const now=timestamp()
    const expense: Expense = {id:makeId(),amount:Number(fd.get('amount')),currency:String(fd.get('currency')) as Currency,date:String(fd.get('date')),category:String(fd.get('category')),note:String(fd.get('note'))||undefined,rateSetId:activeRates?.id,createdAt:now,updatedAt:now}
    if(await commit(()=>db.expenses.add(expense),'Expense saved.')) event.currentTarget.reset()
  }
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">Keep the original</p><h2>Trip costs</h2></div><select className="currency-switcher" value={displayCurrency} onChange={e=>commit(()=>db.metadata.put({key:'displayCurrency',value:e.target.value}))}>{['KES','USD','ZAR'].map(c=><option key={c}>{c}</option>)}</select></div><div className="totals">{totals.map(t=><div key={t.currency}><small>{t.currency}</small><strong>{money(t.amount,t.currency)}</strong></div>)}</div>{!activeRates && <p className="warning">Conversions are off. Review and activate a manual rate set in More. Original totals remain available.</p>}
    <form className="card form-card" onSubmit={submit}><h3>Add an expense</h3><div className="two"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Currency<select name="currency" defaultValue="KES">{['KES','USD','ZAR'].map(c=><option key={c}>{c}</option>)}</select></label></div><div className="two"><label>Date<input name="date" type="date" required defaultValue={data.trip.startDate}/></label><label>Category<input name="category" required placeholder="Food, transport…" /></label></div><label>Note<input name="note"/></label><button disabled={busy}>Save expense</button></form>
    <div className="stack">{[...data.expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(expense=>{const equivalent=convert(expense,displayCurrency);return <article className="card expense" key={expense.id}><div><strong>{money(expense.amount,expense.currency)}</strong>{equivalent!==undefined&&expense.currency!==displayCurrency&&<small>≈ {money(equivalent,displayCurrency)} · recorded rate</small>}<p>{expense.category} · {expense.date}{expense.note?` · ${expense.note}`:''}</p></div><button onClick={()=>confirm('Delete this expense?')&&commit(()=>db.expenses.delete(expense.id))}>Delete</button></article>})}</div></section>
}

function Memories({ data, commit, busy }: SectionProps) {
  const photoFor = (stampId:string)=>data.photos.find(p=>p.stampId===stampId)
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">Postcards to yourself</p><h2>Travel stamps</h2></div><span className="sun">✦</span></div>{!data.stamps.length&&<div className="empty"><span className="stamp-mark">CT</span><h3>Your passport is waiting</h3><p>Mark an itinerary item visited to make a stamp.</p></div>}<div className="memory-grid">{data.stamps.map(stamp=>{const photo=photoFor(stamp.id);return <article className="memory-card" key={stamp.id}>{photo?<img src={URL.createObjectURL(photo.blob)} alt={photo.caption||stamp.placeName}/>:<div className="stamp-art"><span>CAPE<br/>TOWN</span><i>✦</i><small>{stamp.visitDate}</small></div>}<div className="memory-copy"><p className="eyebrow">{stamp.detached?'Detached memory':'Visited'}</p><h3>{stamp.placeName}</h3><p>{formatDate(stamp.visitDate)}</p>{photo&&<p>{photo.caption}</p>}
      <form onSubmit={async e=>{e.preventDefault();const input=e.currentTarget.elements.namedItem('photo') as HTMLInputElement;const caption=(e.currentTarget.elements.namedItem('caption') as HTMLInputElement).value;const file=input.files?.[0];if(!file)return;try{const compressed=await compressPhoto(file);const now=timestamp();await commit(()=>db.photos.put({id:photo?.id??makeId(),stampId:stamp.id,caption,mimeType:compressed.blob.type,width:compressed.width,height:compressed.height,size:compressed.blob.size,blob:compressed.blob,createdAt:photo?.createdAt??now,updatedAt:now}),'Photo saved.')}catch(err){await commit(()=>Promise.reject(err))}}}><label>Photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required/></label><label>Caption<input name="caption" defaultValue={photo?.caption}/></label><button disabled={busy}>{photo?'Replace photo':'Add photo'}</button></form>
      {stamp.detached&&<button className="danger subtle" onClick={()=>confirm('Delete this memory and its photo permanently?')&&commit(()=>db.transaction('rw',[db.stamps,db.photos],async()=>{await db.photos.where('stampId').equals(stamp.id).delete();await db.stamps.delete(stamp.id)}))}>Delete memory</button>}</div></article>})}</div></section>
}

function Settings({ data, commit, busy, onExport, onRestore }: SectionProps & {onExport:()=>void;onRestore:(file:File)=>void}) {
  const [trip,setTrip]=useState<Trip>(data.trip)
  useEffect(()=>setTrip(data.trip),[data.trip])
  const example=data.rateSets[0]
  return <section className="page"><div className="section-heading"><div><p className="eyebrow">The practical pages</p><h2>Notebook settings</h2></div></div>
    <form className="card form-card" onSubmit={async e=>{e.preventDefault();await commit(()=>saveTrip(trip),'Trip updated.')}}><h3>Trip details</h3><label>Destination<input value={trip.destination} onChange={e=>setTrip({...trip,destination:e.target.value})} required/></label><div className="two"><label>Start<input type="date" value={trip.startDate} onChange={e=>setTrip({...trip,startDate:e.target.value})} required/></label><label>End<input type="date" min={trip.startDate} value={trip.endDate} onChange={e=>setTrip({...trip,endDate:e.target.value})} required/></label></div><label>Adults<input type="number" min="1" value={trip.travellers} onChange={e=>setTrip({...trip,travellers:Number(e.target.value)})}/></label><label>Notes<textarea value={trip.notes} onChange={e=>setTrip({...trip,notes:e.target.value})}/></label><button disabled={busy}>Save trip</button></form>
    {example&&<form className="card form-card" onSubmit={async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);await commit(()=>db.transaction('rw',db.rateSets,async()=>{await db.rateSets.toCollection().modify({active:false});await db.rateSets.add({id:makeId(),label:String(fd.get('label')),effectiveDate:String(fd.get('date')),kesPerKes:1,kesPerUsd:Number(fd.get('usd')),kesPerZar:Number(fd.get('zar')),active:true,example:false,createdAt:timestamp()})}),'New immutable rate version activated.')}}><div className="row"><h3>Manual exchange rates</h3><span className="tag">{data.rateSets.some(rate=>rate.active)?'Active version saved':'Example'}</span></div><p>Review these clearly labeled examples. Conversions stay disabled until you activate them. Each activation creates a new version, so old expenses never recalculate.</p><label>Label<input name="label" defaultValue="Reviewed manual rates"/></label><label>Effective date<input name="date" type="date" defaultValue={example.effectiveDate}/></label><div className="two"><label>KES per 1 USD<input name="usd" type="number" min="0.0001" step="0.0001" defaultValue={example.kesPerUsd}/></label><label>KES per 1 ZAR<input name="zar" type="number" min="0.0001" step="0.0001" defaultValue={example.kesPerZar}/></label></div><button disabled={busy}>Activate as new rate version</button></form>}
    <article className="card backup"><h3>Backup & restore</h3><p><strong>Privacy warning:</strong> exported ZIP files are unencrypted and contain your notebook plus actual stored photo files. Keep them somewhere private. Browser storage may be cleared or evicted.</p><div className="actions"><button onClick={onExport} disabled={busy}>Export ZIP</button><label className="file-button">Choose backup<input type="file" accept=".zip,application/zip" onChange={e=>e.target.files?.[0]&&onRestore(e.target.files[0])}/></label></div></article>
    <article className="card"><h3>Install & offline</h3><p>Use your browser’s Add to Home Screen or Install app action after deployment to a stable HTTPS origin. External Google Maps pages still need the internet.</p></article></section>
}
