import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { createItineraryPlace, db, deleteItineraryGroup, deleteItineraryItem, initializeDatabase, loadData, makeId, materializeTemplate, moveItineraryGroup, saveItineraryDetails, saveTrip, scheduleCandidatePlace } from './db'
import { compressPhoto } from './photo'
import type { ActivityTemplate, AppData, BookingStatus, ChecklistItem, Currency, Expense, ItineraryItem, Place, RateSet, Trip } from './types'
import './App.css'

type Tab = 'plan' | 'costs' | 'memories'
const timestamp = () => new Date().toISOString()
const formatDate = (date: string) => new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const money = (amount: number, currency: Currency) => new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
interface SectionProps { data: AppData; commit: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>; busy: boolean }

export function TransientNotice({ message, version, onDismiss }: { message: string; version: number; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), 20_000)
    return () => window.clearTimeout(timer)
  }, [message, version])
  return <div className="message" role="status">{message}<button onClick={onDismiss} aria-label="Dismiss">×</button></div>
}

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

export default function App() {
  const [data, setData] = useState<AppData>()
  const [tab, setTab] = useState<Tab>('plan')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeVersion, setNoticeVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [restoreCandidate, setRestoreCandidate] = useState<AppData>()
  const refresh = async () => setData(await loadData())

  useEffect(() => {
    initializeDatabase().then(refresh).catch(err => setError(String(err)))
  }, [])
  const showNotice = (message: string) => { setNotice(message); setNoticeVersion(version => version + 1) }
  const commit = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await operation()
      await refresh()
      if (success) showNotice(success)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved. Please retry.')
      return false
    } finally { setBusy(false) }
  }
  const exportNotebook = async () => {
    setBusy(true)
    try {
      const blob = await createBackup(data!)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `cape-town-notebook-${new Date().toISOString().slice(0, 10)}.zip`
      link.click()
      URL.revokeObjectURL(link.href)
      showNotice('Backup created.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }
  const selectRestore = async (file: File) => {
    setError('')
    setBusy(true)
    try {
      setRestoreCandidate(await parseBackup(file))
      setSettingsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore validation failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <main className="loading"><span className="stamp-mark">CT</span><p>Opening your notebook…</p>{error && <p role="alert">{error}</p>}</main>
  return <div className="app-shell">
    <header><div className="bo-kaap-strip" aria-hidden="true"/><div className="trip-heading"><div><h1>{data.trip.destination}</h1><p>{formatDate(data.trip.startDate)} — {formatDate(data.trip.endDate)}</p></div><button className="settings-button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></div></header>
    {error && <div className="message error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
    {!error && notice && <TransientNotice message={notice} version={noticeVersion} onDismiss={() => setNotice('')}/>}
    <main>
      {tab === 'plan' && <Plan data={data} commit={commit} busy={busy} />}
      {tab === 'costs' && <Costs data={data} commit={commit} busy={busy} onOpenSettings={() => setSettingsOpen(true)} />}
      {tab === 'memories' && <Memories data={data} commit={commit} busy={busy} />}
    </main>
    <nav aria-label="Notebook sections">{([['plan','Plan','⌁'],['costs','Costs','◒'],['memories','Stamps','✦']] as const).map(([id,label,icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav>
    <Sheet open={settingsOpen} title="Settings" onClose={() => setSettingsOpen(false)}><Settings data={data} commit={commit} busy={busy} onExport={exportNotebook} onRestore={selectRestore}/></Sheet>
    {restoreCandidate && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><p className="eyebrow">Validated backup</p><h2 id="restore-title">Replace this notebook?</h2><p>This will atomically replace all current trip data and photos. It cannot be undone unless you export first.</p><div className="actions"><button className="ghost" onClick={() => setRestoreCandidate(undefined)}>Cancel</button><button className="danger" onClick={async () => { const candidate = restoreCandidate; setRestoreCandidate(undefined); await commit(() => restoreBackup(candidate), 'Notebook restored.') }}>Replace everything</button></div></section></div>}
  </div>
}

function Plan(props: SectionProps) {
  const [view, setView] = useState<'itinerary'|'places'|'checklist'>('itinerary')
  return <section className="page"><div className="section-heading"><h2>Trip</h2></div><div className="segmented">{(['itinerary','places','checklist'] as const).map(id => <button key={id} onClick={() => setView(id)} className={view === id ? 'active' : ''}>{id}</button>)}</div>{view === 'itinerary' && <Itinerary {...props} />}{view === 'places' && <Places {...props} />}{view === 'checklist' && <Checklist {...props} />}</section>
}

function Checklist({ data, commit, busy }: SectionProps) {
  const [editing, setEditing] = useState<ChecklistItem>()
  const [editorOpen, setEditorOpen] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const now = timestamp()
    const item: ChecklistItem = { id: editing?.id ?? makeId(), title: String(fd.get('title')), category: String(fd.get('category')), dueDate: String(fd.get('dueDate')) || undefined, note: String(fd.get('note')) || undefined, completed: editing?.completed ?? false, createdAt: editing?.createdAt ?? now, updatedAt: now }
    if (await commit(() => db.checklist.put(item))) { form.reset(); setEditing(undefined); setEditorOpen(false) }
  }
  const closeEditor = () => { setEditorOpen(false); setEditing(undefined) }
  return <div className="stack"><div className="surface-actions"><p>{data.checklist.filter(item => !item.completed).length} left to do</p><button onClick={() => { setEditing(undefined); setEditorOpen(true) }}>+ Add reminder</button></div>
    {[...data.checklist].sort((a,b) => Number(a.completed)-Number(b.completed)).map(item => <article className={`card checklist-item ${item.completed ? 'done' : ''}`} key={item.id}><button className="check" aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'} onClick={() => commit(() => db.checklist.update(item.id, { completed: !item.completed, updatedAt: timestamp() }))}>{item.completed ? '✓' : ''}</button><div><strong>{item.title}</strong><small>{item.category}{item.dueDate ? ` · Due ${item.dueDate}` : ''}</small>{item.note && item.note !== 'Starter suggestion — verify for your trip.' && <p>{item.note}</p>}<details className="more"><summary>More</summary><div><button onClick={() => { setEditing(item); setEditorOpen(true) }}>Edit</button><button onClick={() => confirm('Delete this checklist item?') && commit(() => db.checklist.delete(item.id))}>Delete</button></div></details></div></article>)}
    <Sheet open={editorOpen} title={editing ? 'Edit reminder' : 'Add a reminder'} onClose={closeEditor}><form className="form-card" onSubmit={submit}><label>Task<input name="title" required defaultValue={editing?.title} /></label><div className="two"><label>Category<input name="category" required defaultValue={editing?.category ?? 'Planning'} /></label><label>Due date<input name="dueDate" type="date" defaultValue={editing?.dueDate} /></label></div><label>Note<textarea name="note" defaultValue={editing?.note} /></label><div className="actions"><button type="button" className="ghost" onClick={closeEditor}>Cancel</button><button disabled={busy}>Save reminder</button></div></form></Sheet>
  </div>
}

interface EntryValues {
  name: string
  notes?: string
  time?: string
  bookingStatus?: BookingStatus
  parentId?: string
  cost?: { amount: number; currency: Currency }
}

function EntryForm({ data, dayId, item, place, expense, onSave, onCancel }: {
  data: AppData
  dayId?: string
  item?: ItineraryItem
  place?: Place
  expense?: Expense
  onSave: (values: EntryValues) => Promise<boolean>
  onCancel: () => void
}) {
  const hasChildren = item && data.items.some(candidate => candidate.parentId === item.id)
  const eligibleParents = dayId && !hasChildren
    ? data.items.filter(candidate => candidate.dayId === dayId && !candidate.parentId && candidate.id !== item?.id)
    : []
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const amount = String(formData.get('cost')).trim()
    const saved = await onSave({
      name: String(formData.get('name')).trim(),
      notes: String(formData.get('notes')).trim() || undefined,
      time: dayId ? String(formData.get('time')) || undefined : undefined,
      bookingStatus: dayId ? (String(formData.get('status')) || undefined) as BookingStatus | undefined : undefined,
      parentId: dayId ? String(formData.get('parentId')) || undefined : undefined,
      cost: amount ? { amount: Number(amount), currency: String(formData.get('currency')) as Currency } : undefined,
    })
    if (saved) form.reset()
  }
  return <form className="form-card" onSubmit={submit}>
    <label>Name<input name="name" required defaultValue={place?.name} placeholder="Place or activity"/></label>
    {dayId && <>
      <label>Parent activity<select name="parentId" defaultValue={item?.parentId ?? ''}><option value="">None — top level</option>{eligibleParents.map(parent => <option key={parent.id} value={parent.id}>{data.places.find(candidate => candidate.id === parent.placeId)?.name}</option>)}</select></label>
      <div className="two"><label>Time<input name="time" type="time" defaultValue={item?.time}/></label><label>Status<select name="status" defaultValue={item?.bookingStatus ?? ''}><option value="">Not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(status => <option key={status}>{status}</option>)}</select></label></div>
    </>}
    <label>Notes<textarea name="notes" defaultValue={item?.notes ?? place?.notes}/></label>
    {dayId && <fieldset className="cost-fields"><legend>Cost · added to expenses</legend><div className="cost-inputs"><label>Amount<input name="cost" type="number" min="0.01" step="0.01" defaultValue={expense?.amount}/></label><label>Currency<select name="currency" defaultValue={expense?.currency ?? 'KES'}>{(['KES','USD','ZAR'] as Currency[]).map(currency => <option key={currency}>{currency}</option>)}</select></label></div></fieldset>}
    <div className="actions"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button>{item || !dayId ? 'Save' : 'Add to day'}</button></div>
  </form>
}

function Itinerary({ data, commit, busy }: SectionProps) {
  const [openDay, setOpenDay] = useState(data.days.find(d => !d.outOfRange)?.id ?? data.days[0]?.id)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string>()
  const day = data.days.find(d => d.id === openDay)
  const dayItems = data.items.filter(i => i.dayId === openDay)
  const items = dayItems.filter(item => !item.parentId).sort((a,b) => a.position-b.position)
  const editingItem = data.items.find(item => item.id === editingItemId)
  const editingPlace = editingItem && data.places.find(place => place.id === editingItem.placeId)
  const editingExpense = editingItem && data.expenses.find(expense => expense.itineraryItemId === editingItem.id)
  const closeEditor = () => { setEditorOpen(false); setEditingItemId(undefined) }
  const openEditor = (item?: ItineraryItem) => { setEditingItemId(item?.id); setEditorOpen(true) }
  const saveEntry = async (values: EntryValues) => {
    if (!day) return false
    if (editingItem) {
      if (editingExpense && !values.cost && !confirm('Remove this recorded expense?')) return false
      const saved = await commit(
        () => saveItineraryDetails(editingItem.id, values, values.cost ?? (editingExpense ? null : undefined)),
      )
      if (saved) closeEditor()
      return saved
    }
    const now = timestamp()
    const place: Place = { id: makeId(), name: values.name, notes: values.notes, wantToVisit: false, createdAt: now, updatedAt: now }
    const item: ItineraryItem = { id: makeId(), dayId: day.id, placeId: place.id, parentId: values.parentId, time: values.time, notes: values.notes, bookingStatus: values.bookingStatus, visited: false, position: Date.now(), createdAt: now, updatedAt: now }
    const saved = await commit(() => createItineraryPlace(place, item, values.cost))
    if (saved) closeEditor()
    return saved
  }
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
  }))
  return <div className="stack"><div className="surface-actions itinerary-surface-actions"><div className="date-strip">{data.days.map(d => <button key={d.id} className={`${openDay === d.id ? 'active' : ''} ${d.outOfRange ? 'flagged' : ''}`} onClick={() => setOpenDay(d.id)}><small>{formatDate(d.date).split(' ')[0]}</small><strong>{d.date.slice(-2)}</strong>{d.outOfRange && <span>!</span>}</button>)}</div><button className="add-action" aria-label="Add activity" onClick={() => openEditor()}>+ Add</button></div>{day?.outOfRange && <p className="warning">Outside current trip dates.</p>}
    {items.map((item,index) => {
      const place = data.places.find(candidate => candidate.id === item.placeId)!
      const linkedExpense = data.expenses.find(expense => expense.itineraryItemId === item.id)
      if (item.isActivityGroup) {
        const children = dayItems.filter(child => child.parentId === item.id).sort((a,b) => a.position-b.position)
        const visitedCount = children.filter(child => child.visited).length
        return <article className="card itinerary-group" key={item.id}>
          <div className="group-heading"><div><div className="card-meta">{item.time && <span className="time-chip">{item.time}</span>}{linkedExpense && <span className="cost-chip">{money(linkedExpense.amount, linkedExpense.currency)}</span>}</div><h3>{place.name}</h3></div>{item.bookingStatus && <span className="tag">{item.bookingStatus}</span>}</div>
          <details className="tour-stops"><summary><span>{children.length} activities</span><strong>{visitedCount}/{children.length}</strong></summary><ol>{children.map(child => {
            const childPlace = data.places.find(candidate => candidate.id === child.placeId)!
            const childExpense = data.expenses.find(expense => expense.itineraryItemId === child.id)
            return <li className={child.visited ? 'stop-visited' : ''} key={child.id}><div className="stop-copy"><div className="card-meta">{child.time && <span className="time-chip">{child.time}</span>}{childExpense && <span className="cost-chip">{money(childExpense.amount, childExpense.currency)}</span>}</div><strong>{childPlace.name}</strong>{child.notes && <small>{child.notes}</small>}</div><div className="stop-actions"><button className={child.visited ? 'visited' : ''} onClick={() => visited(child,childPlace)}>{child.visited ? 'Visited ✓' : 'Mark visited'}</button><details className="more"><summary>More</summary><div><button onClick={() => openEditor(child)}>Edit</button><button onClick={() => confirm(`Delete ${childPlace.name}? Its expense will remain in Costs and its stamp will become a detached memory.`) && commit(() => deleteItineraryItem(child.id))}>Delete</button></div></details></div></li>
          })}</ol></details>
          <details className="more itinerary-more"><summary>More</summary><div className="more-panel"><button onClick={() => openEditor(item)}>Edit</button><button disabled={index===0||busy} onClick={() => move(item,-1)}>Earlier</button><button disabled={index===items.length-1||busy} onClick={() => move(item,1)}>Later</button><select aria-label={`Move ${place.name} to day`} value={item.dayId} onChange={event => commit(() => moveItineraryGroup(item.id,event.target.value))}>{data.days.map(targetDay => <option key={targetDay.id} value={targetDay.id}>{targetDay.date}</option>)}</select><button onClick={() => confirm(`Delete ${place.name}? Expenses remain in Costs; visited stamps and photos remain in Stamps.`) && commit(() => deleteItineraryGroup(item.id))}>Delete</button></div></details>
        </article>
      }
      return <article className="card itinerary-item" key={item.id}><div className="time">{item.time || '—'}</div><div className="itinerary-body"><div className="row"><h3>{place?.name}</h3>{item.bookingStatus && <span className="tag">{item.bookingStatus}</span>}</div><div className="card-meta">{linkedExpense && <span className="cost-chip">{money(linkedExpense.amount, linkedExpense.currency)}</span>}</div>{item.notes && <p>{item.notes}</p>}<div className="primary-actions"><button className={item.visited ? 'visited' : ''} onClick={() => visited(item,place)}>{item.visited ? 'Visited ✓' : 'Mark visited'}</button></div><details className="more itinerary-more"><summary>More</summary><div className="more-panel"><button onClick={() => openEditor(item)}>Edit</button><button disabled={index===0||busy} onClick={() => move(item,-1)}>Earlier</button><button disabled={index===items.length-1||busy} onClick={() => move(item,1)}>Later</button><select aria-label="Move to day" value={item.dayId} onChange={e => commit(() => db.items.update(item.id,{dayId:e.target.value,updatedAt:timestamp()}))}>{data.days.map(d => <option key={d.id} value={d.id}>{d.date}</option>)}</select><button onClick={() => confirm('Delete this activity? Its expense remains in Costs and its stamp becomes a detached memory.') && commit(() => deleteItineraryItem(item.id))}>Delete</button></div></details></div></article>
    })}
    {day && <Sheet open={editorOpen} title={editingItem ? 'Edit activity' : `Add to ${formatDate(day.date)}`} onClose={closeEditor}><EntryForm key={editingItem?.id ?? 'new'} data={data} dayId={day.id} item={editingItem} place={editingPlace} expense={editingExpense} onSave={saveEntry} onCancel={closeEditor}/></Sheet>}
  </div>
}

function SchedulePanel({ name, days, busy, onSchedule }: {
  name: string
  days: AppData['days']
  busy: boolean
  onSchedule: (dayId: string, cost?: EntryValues['cost']) => Promise<boolean>
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const amount = String(formData.get('cost')).trim()
    await onSchedule(String(formData.get('dayId')), amount ? { amount: Number(amount), currency: String(formData.get('currency')) as Currency } : undefined)
  }
  return <form className="schedule-disclosure" onSubmit={submit}>
    <label>Day<select name="dayId" required defaultValue="" aria-label={`Day for ${name}`}><option value="">Choose…</option>{days.map(day => <option key={day.id} value={day.id}>{formatDate(day.date)}</option>)}</select></label>
    <fieldset className="cost-fields compact-cost"><legend>Cost · optional</legend><div className="cost-inputs"><label>Amount<input name="cost" type="number" min="0.01" step="0.01"/></label><label>Currency<select name="currency" defaultValue="KES">{(['KES','USD','ZAR'] as Currency[]).map(currency => <option key={currency}>{currency}</option>)}</select></label></div></fieldset>
    <button disabled={busy}>Add</button>
  </form>
}

function Places({ data, commit, busy }: SectionProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [editingPlace, setEditingPlace] = useState<string>()
  const [editingTemplate, setEditingTemplate] = useState<string>()
  const [scheduling, setScheduling] = useState<string>()
  const schedulePlace = (place: Place, dayId: string, cost?: EntryValues['cost']) => commit(() => scheduleCandidatePlace(place.id, dayId, cost))
  const deletePlace = (place: Place) => commit(() => db.transaction('rw', [db.places, db.items], async () => {
    if (await db.items.where('placeId').equals(place.id).count()) throw new Error('Remove this place from the itinerary before deleting it from Places.')
    await db.places.delete(place.id)
  }))
  const materialize = (template: ActivityTemplate, dayId: string, cost?: EntryValues['cost']) => commit(() => materializeTemplate(template, dayId, cost))
  const templateIds = new Set(data.activityTemplates.map(template => template.id))
  const singleTemplateIds = new Set(data.activityTemplates.filter(template => template.stops.length === 1).map(template => template.id))
  const representedPlaceIds = new Set([
    ...data.activityTemplates.filter(template => template.stops.length === 1).flatMap(template => template.stops.map(stop => stop.placeId).filter((id): id is string => Boolean(id))),
    ...data.items.filter(item => item.templateId && singleTemplateIds.has(item.templateId) && !item.parentId).map(item => item.placeId),
  ])
  const candidatePlaces = data.places.filter(place => {
    if (!place.seeded && !place.wantToVisit) return false
    if (representedPlaceIds.has(place.id)) return false
    if (!place.id.startsWith('template-wishlist-')) return true
    return !templateIds.has(place.id.slice('template-wishlist-'.length))
  })
  return <div className="stack">
    <div className="surface-actions"><span className="count-mark">{candidatePlaces.length}</span><button aria-label="Add place" onClick={() => setAddOpen(true)}>+ Add</button></div>
    <h3 className="subheading">Activities</h3>
    {data.activityTemplates.map(template => <article className="card template-card" key={template.id}>
      {editingTemplate === template.id ? <form className="form-card" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form)
        if (await commit(() => db.activityTemplates.update(template.id, { name: String(fd.get('name')), updatedAt: timestamp() }))) setEditingTemplate(undefined)
      }}><label>Name<input name="name" required defaultValue={template.name}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingTemplate(undefined)}>Cancel</button><button>Save activity</button></div></form> : <>
        <div className="row"><h3>{template.name}</h3><span className="tag">{template.stops.length} {template.stops.length === 1 ? 'activity' : 'activities'}</span></div>
        <details className="route-details"><summary>{template.stops.length > 1 ? `View ${template.stops.length} child activities` : 'View activity details'}</summary><ol className="template-stops">{template.stops.map(stop => <li key={stop.id}><strong>{stop.placeName}</strong>{stop.optional && <span className="tag">Optional</span>}<small>{[...stop.notes, stop.approximateMinutes ? `Approx. ${stop.approximateMinutes >= 60 && stop.approximateMinutes % 60 === 0 ? `${stop.approximateMinutes / 60} hour` : `${stop.approximateMinutes} min`}` : ''].filter(Boolean).join(' · ')}</small></li>)}</ol></details>
        <div className="primary-actions"><button aria-expanded={scheduling === template.id} aria-controls={`schedule-${template.id}`} onClick={() => setScheduling(scheduling === template.id ? undefined : template.id)}>Add to day</button></div>
        {scheduling === template.id && <div id={`schedule-${template.id}`}><SchedulePanel name={template.name} days={data.days} busy={busy} onSchedule={async (dayId, cost) => { const saved = await materialize(template, dayId, cost); if (saved) setScheduling(undefined); return saved }}/></div>}
        <details className="more"><summary>More</summary><div className="more-panel"><button onClick={() => setEditingTemplate(template.id)}>Edit activity</button><button disabled={busy} onClick={() => confirm(`Delete ${template.name} from Activities? Existing itinerary items will remain.`) && commit(() => db.activityTemplates.delete(template.id))}>Delete activity</button></div></details>
      </>}
    </article>)}
    <h3 className="subheading">Places</h3>
    <div className="place-grid">{candidatePlaces.map(place => <article className="card place-card" key={place.id}>
      {editingPlace === place.id ? <form className="form-card" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form)
        if (await commit(() => db.places.update(place.id, { name: String(fd.get('name')), notes: String(fd.get('notes')) || undefined, updatedAt: timestamp() }))) setEditingPlace(undefined)
      }}><label>Name<input name="name" required defaultValue={place.name}/></label><label>Notes<textarea name="notes" defaultValue={place.notes}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingPlace(undefined)}>Cancel</button><button>Save</button></div></form> : <>
        <h3>{place.name}</h3>{place.notes && <p>{place.notes}</p>}<div className="primary-actions"><button aria-expanded={scheduling === place.id} aria-controls={`schedule-${place.id}`} onClick={() => setScheduling(scheduling === place.id ? undefined : place.id)}>Add to day</button></div>
        {scheduling === place.id && <div id={`schedule-${place.id}`}><SchedulePanel name={place.name} days={data.days} busy={busy} onSchedule={async (dayId, cost) => { const saved = await schedulePlace(place, dayId, cost); if (saved) setScheduling(undefined); return saved }}/></div>}
        <details className="more"><summary>More</summary><div className="more-panel"><button onClick={() => setEditingPlace(place.id)}>Edit</button><button onClick={() => confirm(`Delete ${place.name}?`) && deletePlace(place)}>Delete</button></div></details>
      </>}
    </article>)}</div>
    <Sheet open={addOpen} title="Add place" onClose={() => setAddOpen(false)}><EntryForm data={data} onSave={async values => { const now = timestamp(); const saved = await commit(() => db.places.add({ id: makeId(), name: values.name, notes: values.notes, wantToVisit: true, createdAt: now, updatedAt: now })); if (saved) setAddOpen(false); return saved }} onCancel={() => setAddOpen(false)}/></Sheet>
  </div>
}

function Costs({ data, commit, busy, onOpenSettings }: SectionProps & { onOpenSettings: () => void }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const editing = data.expenses.find(expense => expense.id === editingId)
  const displayCurrency = (data.metadata.find(m => m.key === 'displayCurrency')?.value ?? 'KES') as Currency
  const activeRates = data.rateSets.find(r => r.active)
  const totals = (['KES','USD','ZAR'] as Currency[]).map(currency => ({currency,amount:data.expenses.filter(e=>e.currency===currency).reduce((sum,e)=>sum+e.amount,0)}))
  const convert = (expense: Expense, target: Currency) => { const rates = data.rateSets.find(r => r.id === expense.rateSetId); if (!rates) return; const keys: Record<Currency,keyof RateSet> = {KES:'kesPerKes',USD:'kesPerUsd',ZAR:'kesPerZar'}; return expense.amount * Number(rates[keys[expense.currency]]) / Number(rates[keys[target]]) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const now=timestamp()
    const expense: Expense = { id:editing?.id ?? makeId(), amount:Number(fd.get('amount')), currency:String(fd.get('currency')) as Currency, date:editing?.itineraryItemId ? editing.date : String(fd.get('date')), category:String(fd.get('category')), note:String(fd.get('note'))||undefined, itineraryItemId:editing?.itineraryItemId, rateSetId:editing?.rateSetId ?? activeRates?.id, createdAt:editing?.createdAt ?? now, updatedAt:now }
    if(await commit(()=>db.expenses.put(expense))) { form.reset(); setEditorOpen(false); setEditingId(undefined) }
  }
  const closeEditor = () => { setEditorOpen(false); setEditingId(undefined) }
  return <section className="page"><div className="section-heading"><h2>Costs</h2><select className="currency-switcher" aria-label="Display currency" value={displayCurrency} onChange={e=>commit(()=>db.metadata.put({key:'displayCurrency',value:e.target.value}))}>{['KES','USD','ZAR'].map(c=><option key={c}>{c}</option>)}</select></div><div className="totals">{totals.map(t=><div key={t.currency}><small>{t.currency}</small><strong>{money(t.amount,t.currency)}</strong></div>)}</div>{!activeRates && <div className="warning compact-warning"><span>Conversions off</span><button className="text-button" onClick={onOpenSettings}>Settings</button></div>}
    <div className="surface-actions"><span className="count-mark">{data.expenses.length}</span><button onClick={() => { setEditingId(undefined); setEditorOpen(true) }}>+ Add</button></div>
    <div className="stack">{[...data.expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(expense=>{const equivalent=convert(expense,displayCurrency);const linkedItem=data.items.find(item=>item.id===expense.itineraryItemId);const linkedPlace=linkedItem&&data.places.find(place=>place.id===linkedItem.placeId);return <article className="card expense" key={expense.id}><div><strong>{money(expense.amount,expense.currency)}</strong>{equivalent!==undefined&&expense.currency!==displayCurrency&&<small>≈ {money(equivalent,displayCurrency)} · recorded rate</small>}<p>{linkedPlace?.name ?? expense.category} · {formatDate(expense.date)}{expense.note?` · ${expense.note}`:''}</p></div><details className="more"><summary>More</summary><div><button onClick={()=>{setEditingId(expense.id);setEditorOpen(true)}}>Edit</button><button onClick={()=>confirm(expense.itineraryItemId?'Delete this expense? Its activity will no longer show a cost.':'Delete this expense?')&&commit(()=>db.expenses.delete(expense.id))}>Delete</button></div></details></article>})}</div>
    <Sheet open={editorOpen} title={editing ? 'Edit expense' : 'Add expense'} onClose={closeEditor}><form key={editing?.id ?? 'new'} className="form-card" onSubmit={submit}><div className="two"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editing?.amount}/></label><label>Currency<select name="currency" defaultValue={editing?.currency ?? 'KES'}>{['KES','USD','ZAR'].map(c=><option key={c}>{c}</option>)}</select></label></div><div className="two"><label>{editing?.itineraryItemId ? 'Recorded date' : 'Date'}<input name="date" type="date" required readOnly={Boolean(editing?.itineraryItemId)} defaultValue={editing?.date ?? data.trip.startDate}/></label><label>Category<input name="category" required defaultValue={editing?.category ?? ''} placeholder="Food, transport…"/></label></div><label>Note<input name="note" defaultValue={editing?.note}/></label><div className="actions"><button type="button" className="ghost" onClick={closeEditor}>Cancel</button><button disabled={busy}>Save</button></div></form></Sheet>
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
      }))
      if (saved) setEditingStampId(undefined)
    } catch (error) {
      await commit(() => Promise.reject(error))
    }
  }
  return <section className="page"><div className="section-heading"><h2>Stamps</h2></div>{!data.stamps.length&&<div className="empty"><span className="stamp-mark">CT</span><h3>No stamps yet</h3><p>Mark an activity visited.</p></div>}<div className="memory-grid">{data.stamps.map(stamp=>{const photo=photoFor(stamp.id);return <article className="memory-card" key={stamp.id}>{photo?<img src={URL.createObjectURL(photo.blob)} alt={photo.caption||stamp.placeName}/>:<div className="stamp-art"><span>CAPE<br/>TOWN</span><i>✦</i><small>{stamp.visitDate}</small></div>}<div className="memory-copy">{stamp.detached&&<span className="tag">Detached</span>}<h3>{stamp.placeName}</h3><p>{formatDate(stamp.visitDate)}</p>{photo?.caption&&<p>{photo.caption}</p>}<button onClick={() => setEditingStampId(stamp.id)}>{photo ? 'Edit' : 'Add photo'}</button>
      {stamp.detached&&<details className="more danger-zone"><summary>Delete memory</summary><div><p>This permanently deletes this detached stamp and its photo.</p><button className="danger subtle" onClick={()=>confirm('Delete this memory and its photo permanently?')&&commit(()=>db.transaction('rw',[db.stamps,db.photos],async()=>{await db.photos.where('stampId').equals(stamp.id).delete();await db.stamps.delete(stamp.id)}))}>Delete permanently</button></div></details>}</div></article>})}</div>
    <Sheet open={Boolean(editingStamp)} title={editingPhoto ? `Edit ${editingStamp?.placeName}` : `Add photo · ${editingStamp?.placeName ?? ''}`} onClose={() => setEditingStampId(undefined)}><form className="form-card" onSubmit={savePhoto}><label>{editingPhoto ? 'Replacement photo (optional)' : 'Photo'}<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required={!editingPhoto}/></label><p className="form-hint">JPEG, PNG or WebP · max 1600px</p><label>Caption<input name="caption" defaultValue={editingPhoto?.caption}/></label><div className="actions"><button type="button" className="ghost" onClick={() => setEditingStampId(undefined)}>Cancel</button><button disabled={busy}>Save</button></div></form></Sheet>
  </section>
}

function Settings({ data, commit, busy, onExport, onRestore }: SectionProps & {onExport:()=>void;onRestore:(file:File)=>void}) {
  const [trip,setTrip]=useState<Trip>(data.trip)
  useEffect(()=>setTrip(data.trip),[data.trip])
  const example=data.rateSets[0]
  return <div className="settings-stack">
    <details className="card settings-disclosure"><summary><span><strong>Trip</strong><small>{data.trip.destination} · {formatDate(data.trip.startDate)}–{formatDate(data.trip.endDate)}</small></span></summary><form className="form-card" onSubmit={async e=>{e.preventDefault();await commit(()=>saveTrip(trip))}}><label>Destination<input value={trip.destination} onChange={e=>setTrip({...trip,destination:e.target.value})} required/></label><div className="two"><label>Start<input type="date" value={trip.startDate} onChange={e=>setTrip({...trip,startDate:e.target.value})} required/></label><label>End<input type="date" min={trip.startDate} value={trip.endDate} onChange={e=>setTrip({...trip,endDate:e.target.value})} required/></label></div><label>Travellers<input type="number" min="1" value={trip.travellers} onChange={e=>setTrip({...trip,travellers:Number(e.target.value)})}/></label><label>Notes<textarea value={trip.notes} onChange={e=>setTrip({...trip,notes:e.target.value})}/></label><button disabled={busy}>Save</button></form></details>
    {example&&<details className="card settings-disclosure"><summary><span><strong>Exchange rates</strong><small>{data.rateSets.some(rate=>rate.active)?'Active':'Off'}</small></span></summary><form className="form-card" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const fd=new FormData(form);await commit(()=>db.transaction('rw',db.rateSets,async()=>{await db.rateSets.toCollection().modify({active:false});await db.rateSets.add({id:makeId(),label:String(fd.get('label')),effectiveDate:String(fd.get('date')),kesPerKes:1,kesPerUsd:Number(fd.get('usd')),kesPerZar:Number(fd.get('zar')),active:true,example:false,createdAt:timestamp()})}))}}><label>Label<input name="label" defaultValue="Manual rates"/></label><label>Effective date<input name="date" type="date" defaultValue={example.effectiveDate}/></label><div className="two"><label>KES per USD<input name="usd" type="number" min="0.0001" step="0.0001" defaultValue={example.kesPerUsd}/></label><label>KES per ZAR<input name="zar" type="number" min="0.0001" step="0.0001" defaultValue={example.kesPerZar}/></label></div><button disabled={busy}>Activate</button></form></details>}
    <article className="card backup"><h3>Backup</h3><p><strong>Private:</strong> unencrypted ZIP with photos.</p><div className="actions"><button onClick={onExport} disabled={busy}>Export ZIP</button><label className="file-button">Restore ZIP<input type="file" accept=".zip,application/zip" onChange={e=>e.target.files?.[0]&&onRestore(e.target.files[0])}/></label></div></article>
  </div>
}
