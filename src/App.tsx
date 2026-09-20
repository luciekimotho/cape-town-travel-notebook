import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createBackup, parseBackup } from './backup'
import { makeId } from './db'
import { localNotebookStore, type NotebookStore } from './notebookStore'
import { compressPhoto } from './photo'

import { artKindFor, colorForKind, EmptyDayArt, LineIcon, MarkerIcon, PlaceScene, PlaceThumbnail, TravelStamp } from './Artwork'
import { MomentPostcard, PostcardStamp } from './MomentPostcard'
import { errorMessage } from './errorMessage'
import { StampPicker } from './StampPicker'
import type { StampDesign } from './stampDesign'
import { DownloadSettings } from './DownloadSettings'
import type { ActivityTemplate, AppData, BookingStatus, ChecklistItem, Currency, Expense, ItineraryItem, PhotoEntry, Place, RateSet, TravelStamp as Stamp } from './types'
import './App.css'

type Tab = 'itinerary' | 'places' | 'moments' | 'checklist' | 'costs'
type DetailRoute = { itemId: string; origin: Tab; parentId?: string }
const timestamp = () => new Date().toISOString()
const formatDate = (date: string, weekday = true) => new Intl.DateTimeFormat('en-KE', { ...(weekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const formatTripRange = (start: string, end: string) => {
  const startDate = new Date(`${start}T12:00:00Z`)
  const endDate = new Date(`${end}T12:00:00Z`)
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  return sameMonth
    ? `${startDate.getUTCDate()}–${endDate.getUTCDate()} ${new Intl.DateTimeFormat('en', { month:'long', timeZone:'UTC' }).format(endDate)}`
    : `${formatDate(start, false)}–${formatDate(end, false)}`
}
const money = (amount: number, currency: Currency) => new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
const currencies: Currency[] = ['KES', 'USD', 'ZAR']
interface SectionProps { data: AppData; commit: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>; busy: boolean }
export interface CloudAccountControls {
  email: string
  role: 'owner' | 'editor'
  pendingEmail: string | null
  claimedEmail: string | null
  claimedUserId: string | null
  share(email: string): Promise<void>
  revokePending(): Promise<void>
  removeEditor(userId: string): Promise<void>
  signOut(): Promise<void>
}
export interface DownloadControls {
  savedAt?: string
  downloading: boolean
  progress?: string
  error?: string
  onDownload?: () => Promise<void>
  onRemove: () => Promise<void>
  onUseDownload?: () => void
  onReturnLive?: () => void
  onSignOut?: () => Promise<void>
}
const NotebookStoreContext = createContext<NotebookStore>(localNotebookStore)
const useNotebookStore = () => useContext(NotebookStoreContext)
const ReadOnlyContext = createContext(false)
const useReadOnly = () => useContext(ReadOnlyContext)

export function TransientNotice({ message, version, onDismiss, tone = 'status' }: { message: string; version: number; onDismiss: () => void; tone?: 'status' | 'error' }) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), 20_000)
    return () => window.clearTimeout(timer)
  }, [message, version])
  return <div className={`message ${tone === 'error' ? 'error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>{message}<button onClick={onDismiss} aria-label="Dismiss">×</button></div>
}

function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const readOnly = useReadOnly()
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const background = [...document.querySelectorAll<HTMLElement>('.app-header,.app-main,.bottom-nav,.backbar,.detail-main')]
      .filter(element => !panel || !element.contains(panel))
    background.forEach(element => element.setAttribute('inert', ''))
    panel?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')].filter(element => !element.matches(':disabled'))
      if (!focusable.length) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); background.forEach(element => element.removeAttribute('inert')); returnFocusRef.current?.focus() }
  }, [open])
  if (!open) return null
  return <div className="sheet-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="sheet" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="sheet-heading"><h2 id={titleId}>{title}</h2><button className="icon-button close-button" onClick={onClose} aria-label={`Close ${title}`}>×</button></div>
      <div className="sheet-body">{title === 'Settings' ? children : <fieldset className="sheet-readonly-fields" disabled={readOnly}>{children}</fieldset>}</div>
    </section>
  </div>
}

function PhotoImage({ photo, alt, className }: { photo: PhotoEntry; alt: string; className?: string }) {
  const [source, setSource] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(photo.blob)
    setSource(url)
    return () => URL.revokeObjectURL(url)
  }, [photo.blob])
  return source ? <img className={className} src={source} alt={alt}/> : null
}

export default function App() {
  return <NotebookApplication store={localNotebookStore}/>
}

export function NotebookApplication({ store, account, initialData, readOnly = false, readOnlyReason, downloads }: {
  store: NotebookStore
  account?: CloudAccountControls
  initialData?: AppData
  readOnly?: boolean
  readOnlyReason?: string
  downloads?: DownloadControls
}) {
  return <NotebookStoreContext.Provider value={store}><ReadOnlyContext.Provider value={readOnly || Boolean(store.readOnly)}><NotebookApp account={account} initialData={initialData} downloads={downloads} readOnlyReason={readOnlyReason}/></ReadOnlyContext.Provider></NotebookStoreContext.Provider>
}

function NotebookApp({ account, initialData, downloads, readOnlyReason }: { account?: CloudAccountControls; initialData?: AppData; downloads?: DownloadControls; readOnlyReason?: string }) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const [data, setData] = useState<AppData | undefined>(initialData)
  const [tab, setTab] = useState<Tab>('itinerary')
  const [detail, setDetail] = useState<DetailRoute>()
  const [error, setError] = useState('')
  const [errorVersion, setErrorVersion] = useState(0)
  const [notice, setNotice] = useState('')
  const [noticeVersion, setNoticeVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [restoreCandidate, setRestoreCandidate] = useState<AppData>()
  const detailReturnRef = useRef<HTMLElement | null>(null)
  const refresh = async () => setData(await store.load())

  const showError = (message: string) => { setError(message); setErrorVersion(version => version + 1) }
  useEffect(() => {
    let active = true
    if (initialData) { setData(initialData); return }
    setData(undefined)
    store.initialize().then(() => store.load()).then(next => { if (active) setData(next) }).catch(err => { if (active) showError(errorMessage(err, 'The notebook could not be opened.')) })
    return () => { active = false }
  }, [store, initialData])
  const showNotice = (message: string) => { setNotice(message); setNoticeVersion(version => version + 1) }
  const commit = async (operation: () => Promise<unknown>, success?: string) => {
    if (readOnlyRef.current) { showError('This copy is read-only. Reconnect and open the live trip to make changes.'); return false }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await operation()
      if (result && typeof result === 'object' && 'notebook' in result) {
        const saved = result as { notebook:AppData; warning?:string }
        setData(saved.notebook)
        if (saved.warning) showError(saved.warning)
      } else if (result && typeof result === 'object' && 'trip' in result) setData(result as AppData)
      else await refresh()
      if (success) showNotice(success)
      return true
    } catch (err) {
      showError(errorMessage(err, 'The change could not be saved. Please retry.'))
      return false
    } finally { setBusy(false) }
  }
  const exportNotebook = async () => {
    if (!data) return
    setBusy(true); setError('')
    try {
      const blob = await createBackup(data)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `cape-town-notebook-${new Date().toISOString().slice(0, 10)}.zip`
      link.click()
      URL.revokeObjectURL(link.href)
      showNotice('Backup created.')
    } catch (err) { showError(err instanceof Error ? err.message : 'Export failed.') }
    finally { setBusy(false) }
  }
  const selectRestore = async (file: File) => {
    if (readOnlyRef.current) { showError('Restore is unavailable in read-only mode.'); return }
    setError(''); setBusy(true)
    try { setRestoreCandidate(await parseBackup(file)); setSettingsOpen(false) }
    catch (err) { showError(err instanceof Error ? err.message : 'Restore validation failed.') }
    finally { setBusy(false) }
  }
  const openItem = (itemId: string, origin: Tab, parentId?: string) => {
    detailReturnRef.current = document.activeElement as HTMLElement | null
    setDetail({ itemId, origin, parentId })
  }
  const backFromDetail = () => {
    if (detail?.parentId) { setDetail({ itemId:detail.parentId, origin:detail.origin }); return }
    setDetail(undefined)
    window.setTimeout(() => detailReturnRef.current?.focus(), 0)
  }

  if (!data) return <main className="loading"><span className="stamp-mark">CT</span><p>Opening your notebook…</p>{error && <TransientNotice message={error} version={errorVersion} tone="error" onDismiss={() => setError('')}/>}</main>
  return <div className="app-shell">
    {!detail && <header className="app-header"><div className="title-panel"><h1>Capetown 2026</h1><p>{formatTripRange(data.trip.startDate,data.trip.endDate)}</p></div><button className="settings-button" aria-label="Open settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></header>}
    {readOnly && <div className="download-status" role="status"><span><strong>{readOnlyReason ?? (store.kind === 'download' ? 'Downloaded trip · read-only' : 'Connection unavailable · read-only')}</strong>{store.kind === 'download' && downloads?.savedAt && <small>Saved {new Date(downloads.savedAt).toLocaleString()}</small>}</span><button type="button" onClick={() => setSettingsOpen(true)}>Options</button></div>}
    {error && <TransientNotice message={error} version={errorVersion} tone="error" onDismiss={() => setError('')}/>}
    {!error && notice && <TransientNotice message={notice} version={noticeVersion} onDismiss={() => setNotice('')}/>}
    {detail ? <ActivityDetail route={detail} data={data} commit={commit} busy={busy} onBack={backFromDetail} onOpenChild={childId => setDetail({ itemId: childId, origin: detail.origin, parentId: detail.itemId })}/> :
      <main className="app-main">
        {tab === 'itinerary' && <Itinerary data={data} commit={commit} busy={busy} onOpen={(id, parent) => openItem(id, 'itinerary', parent)}/>}
        {tab === 'places' && <Places data={data} commit={commit} busy={busy}/>}
        {tab === 'moments' && <Moments data={data} commit={commit} busy={busy} onOpen={id => openItem(id, 'moments')}/>}
        {tab === 'checklist' && <Checklist data={data} commit={commit} busy={busy}/>}
        {tab === 'costs' && <Costs data={data} commit={commit} busy={busy} onOpenSettings={() => setSettingsOpen(true)}/>}
      </main>}
    {!detail && <BottomNav tab={tab} onChange={setTab}/>}
    <Sheet open={settingsOpen} title="Settings" onClose={() => setSettingsOpen(false)}><Settings data={data} commit={commit} busy={busy} onExport={exportNotebook} onRestore={selectRestore} account={account} downloads={downloads}/></Sheet>
    {restoreCandidate && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><h2 id="restore-title">Replace this notebook?</h2><p>This atomically replaces all current trip data and photos. Export a backup first if you may need to undo it.</p><div className="actions"><button className="ghost" onClick={() => setRestoreCandidate(undefined)}>Cancel</button><button className="danger" disabled={readOnly || busy} onClick={async () => { const candidate = restoreCandidate; if(await commit(() => store.replaceAll(candidate), 'Notebook restored.'))setRestoreCandidate(undefined) }}>Replace notebook</button></div></section></div>}
  </div>
}

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const items: [Tab, string][] = [['itinerary','Itinerary'],['places','Places'],['moments','Moments'],['checklist','Checklist'],['costs','Costs']]
  return <nav className="bottom-nav" aria-label="Notebook sections">{items.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => onChange(id)}><LineIcon name={id}/><span>{label}</span></button>)}</nav>
}

interface EntryValues {
  name: string
  stampKind: StampDesign
  dayId?: string
  parentId?: string
  time?: string
  bookingStatus?: BookingStatus
  address?: string
  googleMapsUrl?: string
  notes?: string
  cost?: { amount: number; currency: Currency }
}

function FormActions({ label, busy, onDelete }: { label: string; busy: boolean; onDelete?: () => void }) {
  const readOnly = useReadOnly()
  return <div className="form-actions">{onDelete && <button className="delete-icon" type="button" disabled={readOnly || busy} onClick={onDelete} aria-label={`Delete ${label}`} title={`Delete ${label}`}><LineIcon name="trash"/></button>}<button className="save-icon" disabled={busy || readOnly} type="submit" aria-label={`Save ${label}`} title={`Save ${label}`}><LineIcon name="save"/></button></div>
}

function ActivityForm({ data, item, place, expense, defaultDayId, fixedTemplate, busy, onSave, onDelete }: {
  data: AppData
  item?: ItineraryItem
  place?: Place
  expense?: Expense
  defaultDayId?: string
  fixedTemplate?: ActivityTemplate
  busy: boolean
  onSave: (values: EntryValues) => Promise<boolean>
  onDelete?: () => void
}) {
  const initialDay = item?.dayId ?? defaultDayId ?? ''
  const [dayId, setDayId] = useState(initialDay)
  const [parentId, setParentId] = useState(item?.parentId ?? '')
  const [name, setName] = useState(place?.name ?? fixedTemplate?.name ?? '')
  const [stampKind, setStampKind] = useState<StampDesign>(item?.stampKind ?? place?.stampKind ?? fixedTemplate?.stampKind ?? (item || place || fixedTemplate ? 'auto' : 'pin'))
  const hasChildren = Boolean(item && data.items.some(candidate => candidate.parentId === item.id)) || Boolean(fixedTemplate && fixedTemplate.stops.length > 1)
  const eligibleParents = !hasChildren && dayId
    ? data.items.filter(candidate => candidate.dayId === dayId && !candidate.parentId && candidate.id !== item?.id)
    : []
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const fd = new FormData(form)
    const amount = String(fd.get('cost')).trim()
    const saved = await onSave({
      name: String(fd.get('name')).trim(),
      stampKind,
      dayId: dayId || undefined,
      parentId: parentId || undefined,
      time: String(fd.get('time')) || undefined,
      bookingStatus: (String(fd.get('status')) || undefined) as BookingStatus | undefined,
      address: String(fd.get('address')).trim() || undefined,
      googleMapsUrl: String(fd.get('googleMapsUrl')).trim() || undefined,
      notes: String(fd.get('notes')).trim() || undefined,
      cost: amount ? { amount: Number(amount), currency: String(fd.get('currency')) as Currency } : undefined,
    })
    if (saved) form.reset()
  }
  return <form className="form-card activity-form" onSubmit={submit}>
    <label className="field">Name *<input name="name" required maxLength={90} value={name} onChange={event => setName(event.target.value)}/></label>
    <StampPicker name={name} value={stampKind} date={data.days.find(day => day.id === dayId)?.date ?? data.trip.startDate} disabled={busy} onChange={setStampKind}/>
    <label className="field">Parent activity<select name="parentId" value={parentId} disabled={hasChildren} onChange={event => { const next = event.target.value; setParentId(next); if (next) setDayId(data.items.find(candidate => candidate.id === next)?.dayId ?? dayId) }}><option value="">None</option>{eligibleParents.map(parent => <option key={parent.id} value={parent.id}>{data.places.find(candidate => candidate.id === parent.placeId)?.name}</option>)}</select></label>
    <div className="fields-two"><label className="field">Day<select name="dayId" value={dayId} onChange={event => { setDayId(event.target.value); setParentId('') }}><option value="">Unscheduled</option>{data.days.map(day => <option key={day.id} value={day.id}>{formatDate(day.date)}</option>)}</select></label><label className="field">Time<input name="time" type="time" defaultValue={item?.time}/></label></div>
    <div className="fields-two"><label className="field">Cost<input name="cost" type="number" min="0.01" step="0.01" defaultValue={expense?.amount}/></label><label className="field">Currency<select name="currency" defaultValue={expense?.currency ?? 'KES'}>{currencies.map(currency => <option key={currency}>{currency}</option>)}</select></label></div>
    <label className="field">Booking status<select name="status" defaultValue={item?.bookingStatus ?? ''}><option value="">Not set</option>{['Idea','To book','Booked','Confirmed','Cancelled'].map(status => <option key={status}>{status}</option>)}</select></label>
    <label className="field">Address<input name="address" defaultValue={place?.address}/></label>
    <label className="field">Google Maps URL<input name="googleMapsUrl" type="url" defaultValue={place?.googleMapsUrl}/></label>
    <label className="field">Notes<textarea name="notes" defaultValue={item?.notes ?? place?.notes ?? fixedTemplate?.description}/></label>
    <FormActions label="activity" busy={busy} onDelete={onDelete}/>
  </form>
}

function Itinerary({ data, commit, busy, onOpen }: SectionProps & { onOpen: (itemId: string, parentId?: string) => void }) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const [openDay, setOpenDay] = useState(data.days.find(day => !day.outOfRange)?.id ?? data.days[0]?.id)
  const [editorOpen, setEditorOpen] = useState(false)
  const day = data.days.find(candidate => candidate.id === openDay)
  const dayItems = data.items.filter(item => item.dayId === openDay)
  const roots = dayItems.filter(item => !item.parentId).sort((a,b) => a.position-b.position)
  const add = async (values: EntryValues) => {
    if (!values.dayId) return commit(() => Promise.reject(new Error('Choose a day for this activity.')))
    const now = timestamp()
    const place: Place = { id:makeId(), name:values.name, stampKind:values.stampKind, address:values.address, googleMapsUrl:values.googleMapsUrl, notes:values.notes, wantToVisit:false, createdAt:now, updatedAt:now }
    const item: ItineraryItem = { id:makeId(), dayId:values.dayId, placeId:place.id, stampKind:values.stampKind, parentId:values.parentId, time:values.time, bookingStatus:values.bookingStatus, notes:values.notes, visited:false, position:Date.now(), createdAt:now, updatedAt:now }
    const saved = await commit(() => store.createItineraryPlace(place, item, values.cost))
    if (saved) { setOpenDay(values.dayId); setEditorOpen(false) }
    return saved
  }
  return <section className="page">
    <div className="section-row"><h2>Itinerary</h2><button className="icon-button add-button" aria-label="Add activity" disabled={readOnly} onClick={() => setEditorOpen(true)}>+</button></div>
    <div className="day-rail" aria-label="Trip days">{data.days.map((candidate, index) => <button key={candidate.id} className={`day ${candidate.id === openDay ? 'active' : ''} ${candidate.outOfRange ? 'flagged' : ''}`} style={{ '--day-accent': ['#008c95','#bc3557','#b57e0b','#2855a6','#4e8548'][index % 5] } as React.CSSProperties} aria-pressed={candidate.id === openDay} onClick={() => setOpenDay(candidate.id)}><span>{formatDate(candidate.date).slice(0,1)}</span><strong>{candidate.date.slice(-2)}</strong></button>)}</div>
    {day?.outOfRange && <p className="warning">Outside current trip dates.</p>}
    {day && <div className="day-summary"><h3>{new Intl.DateTimeFormat('en-KE',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`))}</h3><span>{roots.length} {roots.length === 1 ? 'activity' : 'activities'}</span></div>}
    {roots.map(item => <ItineraryCard key={item.id} item={item} data={data} onOpen={onOpen}/>)}
    {!roots.length && <div className="empty-day"><EmptyDayArt/><h3>A little room to explore.</h3></div>}
    <Sheet open={editorOpen} title="Add activity" onClose={() => setEditorOpen(false)}><ActivityForm data={data} defaultDayId={day?.id} busy={busy} onSave={add}/></Sheet>
  </section>
}

function ItineraryCard({ item, data, onOpen }: { item: ItineraryItem; data: AppData; onOpen: (itemId: string, parentId?: string) => void }) {
  const place = data.places.find(candidate => candidate.id === item.placeId)!
  const children = data.items.filter(candidate => candidate.parentId === item.id).sort((a,b) => a.position-b.position)
  const stamp = data.stamps.find(candidate => candidate.itineraryItemId === item.id)
  const expense = data.expenses.find(candidate => candidate.itineraryItemId === item.id)
  const heading = <button className="activity-card" onClick={() => onOpen(item.id)}><span className="thumb"><PlaceThumbnail name={place.name}/></span><span className="card-copy"><h3>{place.name}</h3>{children.length > 0 && <small>{children.length} stops · {children.filter(child => child.visited).length} stamped</small>}{item.time && <small>{item.time}</small>}{expense && <small className="cost-pill">{money(expense.amount, expense.currency)}</small>}</span>{stamp ? <span className="mini-stamp"><TravelStamp name={place.name} date={stamp.visitDate} stampKind={stamp.stampKind}/></span> : <span className="chevron" aria-hidden="true">›</span>}</button>
  if (!children.length) return heading
  return <article className="tour-card">{heading}<div className="route-list compact-route" role="group" aria-label={`${place.name} stops`}>{children.map(child => <RouteRow key={child.id} item={child} data={data} compact onOpen={() => onOpen(child.id)}/>)}</div></article>
}

function RouteRow({ item, data, compact, onOpen }: { item: ItineraryItem; data: AppData; compact?: boolean; onOpen: () => void }) {
  const place = data.places.find(candidate => candidate.id === item.placeId)!
  const stamp = data.stamps.find(candidate => candidate.itineraryItemId === item.id)
  const kind = artKindFor(place.name)
  return <button className={`route-row ${compact ? 'compact' : ''}`} style={{ '--place-color': colorForKind(kind) } as React.CSSProperties} onClick={onOpen}><span className={`stop-number ${stamp ? 'is-stamped' : ''}`}>{stamp ? <TravelStamp name={place.name} date={stamp.visitDate} stampKind={stamp.stampKind}/> : <MarkerIcon kind={kind}/>}</span><span className="stop-copy">{place.name}{item.notes && <small>{item.notes}</small>}</span><span className="chevron" aria-hidden="true">›</span></button>
}

function ActivityDetail({ route, data, commit, busy, onBack, onOpenChild }: { route: DetailRoute; data: AppData; commit: SectionProps['commit']; busy: boolean; onBack: () => void; onOpenChild: (id: string) => void }) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const item = data.items.find(candidate => candidate.id === route.itemId)
  const place = item && data.places.find(candidate => candidate.id === item.placeId)
  const day = item && data.days.find(candidate => candidate.id === item.dayId)
  const stamp = data.stamps.find(candidate => candidate.itineraryItemId === item?.id)
  const photo = stamp && data.photos.find(candidate => candidate.stampId === stamp.id)
  const expense = data.expenses.find(candidate => candidate.itineraryItemId === item?.id)
  const children = data.items.filter(candidate => candidate.parentId === item?.id).sort((a,b) => a.position-b.position)
  const [editorOpen, setEditorOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [justStamped, setJustStamped] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { setJustStamped(false); headingRef.current?.focus({preventScroll:true}) }, [item?.id])
  if (!item || !place || !day) return <main className="detail-main"><button onClick={onBack}>Back</button><p>This activity is no longer available.</p></main>

  const toggleStamp = async () => {
    if (stamp) {
      if (photo && !confirm('Undo this stamp and permanently delete its photo?')) return
      const saved = await commit(() => store.undoStamp(stamp.id, item.id))
      if (saved) setJustStamped(false)
      return
    }
    const saved = await commit(() => store.createStamp({id:makeId(),itineraryItemId:item.id,placeName:place.name,visitDate:day.date,detached:false,createdAt:timestamp()}, item.id))
    if (saved) setJustStamped(true)
  }
  const save = async (values: EntryValues) => {
    if (!values.dayId) return commit(() => Promise.reject(new Error('Choose a day for this activity.')))
    if (expense && !values.cost && !confirm('Remove this recorded expense?')) return false
    const saved = await commit(() => store.saveItineraryDetails(item.id, {
      name:values.name, stampKind:values.stampKind, dayId:values.dayId, parentId:values.parentId, time:values.time, bookingStatus:values.bookingStatus,
      notes:values.notes, address:values.address, googleMapsUrl:values.googleMapsUrl,
    }, values.cost ?? (expense ? null : undefined)))
    if (saved) setEditorOpen(false)
    return saved
  }
  const remove = async () => {
    const message = children.length ? `Delete ${place.name}? Expenses remain in Costs; stamped moments and photos become detached.` : `Delete ${place.name}? Its expense remains in Costs and its stamped moment becomes detached.`
    if (!confirm(message)) return
    const saved = await commit(() => children.length ? store.deleteItineraryGroup(item.id) : store.deleteItineraryItem(item.id))
    if (saved) { setEditorOpen(false); onBack() }
  }
  return <>
    <div className="backbar"><button className="back-button" onClick={onBack}><span aria-hidden="true">‹</span>{route.parentId ? data.places.find(candidate => candidate.id === data.items.find(entry => entry.id === route.parentId)?.placeId)?.name : route.origin === 'moments' ? 'Moments' : 'Itinerary'}</button><button className="text-action" disabled={readOnly} onClick={() => setEditorOpen(true)}>Edit</button></div>
    <main className="detail-main">
      <div className="hero"><PlaceScene name={place.name}/>{stamp && <div className={`hero-stamp ${justStamped ? 'stamp-pop' : ''}`}><TravelStamp name={place.name} date={stamp.visitDate} stampKind={stamp.stampKind}/></div>}</div>
      <div className="detail-title"><h1 ref={headingRef} tabIndex={-1}>{place.name}</h1><p>{formatDate(day.date, false)}{item.time ? ` · ${item.time}` : ''}{children.length ? ` · ${children.length} stops` : ''}{item.bookingStatus ? ` · ${item.bookingStatus}` : ''}</p></div>
      {stamp ? <div className="stamped-line"><button disabled={readOnly} onClick={toggleStamp}>Undo stamp</button></div> : <button className="stamp-action" disabled={readOnly} onClick={toggleStamp}><LineIcon name="moments"/>Stamp this visit</button>}
      {(place.address || place.googleMapsUrl || item.notes) && <section className="detail-section specifics">{place.address && <p>{place.address}</p>}{item.notes && <p>{item.notes}</p>}{place.googleMapsUrl && (readOnly ? <p className="caption">Google Maps needs the live connection.</p> : <a href={place.googleMapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>)}</section>}
      {children.length > 0 && <section className="detail-section"><div className="route-list" role="group" aria-label={`${place.name} stops`}>{children.map(child => <RouteRow key={child.id} item={child} data={data} onOpen={() => onOpenChild(child.id)}/>)}</div></section>}
      <section className="detail-section"><div className="detail-heading"><h2>Moments</h2>{stamp && <button className="text-action" disabled={readOnly} onClick={() => setPhotoOpen(true)}>{photo ? 'Edit' : '+ Add'}</button>}</div>{photo ? <><PhotoImage photo={photo} alt={photo.caption || place.name} className="memory-image"/>{photo.caption && <p className="caption">{photo.caption}</p>}</> : stamp ? <button className="photo-placeholder" disabled={readOnly} onClick={() => setPhotoOpen(true)}><LineIcon name="camera"/>Add a photo</button> : <p className="small-label">{readOnly ? 'No saved photo for this activity.' : 'Stamp your visit to add a photo.'}</p>}</section>
      <section className="detail-section"><div className="detail-heading"><h2>Cost</h2><button className="text-action" disabled={readOnly} onClick={() => setEditorOpen(true)}>{expense ? 'Edit' : '+ Add'}</button></div>{expense && <div className="expense-row"><strong>{money(expense.amount,expense.currency)}</strong></div>}</section>
    </main>
    <Sheet open={editorOpen} title="Edit activity" onClose={() => setEditorOpen(false)}><ActivityForm data={data} item={item} place={place} expense={expense} busy={busy} onSave={save} onDelete={remove}/></Sheet>
    {stamp && <PhotoEditor open={photoOpen} stamp={stamp} photo={photo} busy={busy} commit={commit} onClose={() => setPhotoOpen(false)}/>}
  </>
}

function PhotoEditor({ open, stamp, photo, busy, commit, onClose }: { open: boolean; stamp: Stamp; photo?: PhotoEntry; busy: boolean; commit: SectionProps['commit']; onClose: () => void }) {
  const store = useNotebookStore()
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const input = form.elements.namedItem('photo') as HTMLInputElement
    const caption = (form.elements.namedItem('caption') as HTMLInputElement).value
    const file = input.files?.[0]
    if (!file && !photo) return
    try {
      const compressed = file ? await compressPhoto(file) : undefined
      const now = timestamp()
      const saved = await commit(() => store.savePhoto({ id:photo?.id ?? makeId(), stampId:stamp.id, caption, mimeType:compressed?.blob.type ?? photo!.mimeType, width:compressed?.width ?? photo!.width, height:compressed?.height ?? photo!.height, size:compressed?.blob.size ?? photo!.size, blob:compressed?.blob ?? photo!.blob, createdAt:photo?.createdAt ?? now, updatedAt:now }))
      if (saved) onClose()
    } catch (error) { await commit(() => Promise.reject(error)) }
  }
  const remove = photo ? () => { if (confirm('Delete this photo permanently? The stamp will remain.')) commit(() => store.deletePhoto(photo)).then(saved => saved && onClose()) } : undefined
  return <Sheet open={open} title="Moment" onClose={onClose}><form className="form-card" onSubmit={save}><label className="field">Photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required={!photo}/></label><p className="form-hint">JPEG, PNG or WebP · max 1600px</p><label className="field">Caption<input name="caption" defaultValue={photo?.caption}/></label><FormActions label="photo" busy={busy} onDelete={remove}/></form></Sheet>
}

function Checklist({ data, commit, busy }: SectionProps) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const categories = ['Planning','Documents','Shopping'] as const
  const [editing, setEditing] = useState<ChecklistItem>()
  const [editorOpen, setEditorOpen] = useState(false)
  const close = () => { setEditorOpen(false); setEditing(undefined) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form=event.currentTarget; const fd=new FormData(form); const now=timestamp()
    const item: ChecklistItem = { id:editing?.id ?? makeId(), title:String(fd.get('title')).trim(), category:String(fd.get('category')).trim(), dueDate:String(fd.get('dueDate'))||undefined, note:String(fd.get('note')).trim()||undefined, completed:editing?.completed ?? false, createdAt:editing?.createdAt ?? now, updatedAt:now }
    if (await commit(() => store.saveChecklist(item))) close()
  }
  const remove = () => editing && confirm('Delete this reminder?') && commit(() => store.deleteChecklist(editing.id)).then(saved => saved && close())
  const items=[...data.checklist].sort((a,b)=>Number(a.completed)-Number(b.completed))
  const categoryFor = (item?: ChecklistItem) => item && categories.includes(item.category as typeof categories[number]) ? item.category : 'Planning'
  return <section className="page"><div className="section-row"><h2>Checklist</h2><button className="icon-button add-button" aria-label="Add reminder" disabled={readOnly} onClick={() => {setEditing(undefined);setEditorOpen(true)}}>+</button></div>{categories.map(category=>{const categoryItems=items.filter(item=>categoryFor(item)===category);return <details className="checklist-section" key={category} open><summary><strong>{category}</strong><span>{categoryItems.filter(item=>item.completed).length}/{categoryItems.length}</span></summary><div className="plain-list">{categoryItems.map(item=><div className={`plain-row checklist-row ${item.completed?'checked':''}`} key={item.id}><button className="check-toggle" disabled={readOnly} aria-label={`${item.completed?'Uncheck':'Complete'} ${item.title}`} aria-pressed={item.completed} onClick={()=>commit(()=>store.setChecklistCompleted(item.id,!item.completed,timestamp()))}><span className="check-box">{item.completed?'✓':''}</span></button><button className="copy row-open" onClick={()=>{setEditing(item);setEditorOpen(true)}}><strong>{item.title}</strong>{item.dueDate&&<small>{formatDate(item.dueDate)}</small>}</button></div>)}</div></details>})}
    <Sheet open={editorOpen} title={editing?'Edit reminder':'Add reminder'} onClose={close}><form className="form-card" onSubmit={submit}><label className="field">Reminder *<input name="title" required defaultValue={editing?.title}/></label><div className="fields-two"><label className="field">Category<select name="category" defaultValue={categoryFor(editing)}>{categories.map(category=><option key={category}>{category}</option>)}</select></label><label className="field">Due date<input name="dueDate" type="date" defaultValue={editing?.dueDate}/></label></div><label className="field">Note<textarea name="note" defaultValue={editing?.note}/></label><div className="reminder-actions">{editing&&<button type="button" className="danger" onClick={remove} disabled={busy}>Delete</button>}<button type="button" className="ghost" onClick={close}>Cancel</button><button type="submit" className="save" disabled={busy}>Save reminder</button></div></form></Sheet>
  </section>
}

function Places({ data, commit, busy }: SectionProps) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const [placeEditor, setPlaceEditor] = useState<Place>()
  const [adding, setAdding] = useState(false)
  const [template, setTemplate] = useState<ActivityTemplate>()
  const templateIds=new Set(data.activityTemplates.map(entry=>entry.id))
  const singleTemplateIds=new Set(data.activityTemplates.filter(entry=>entry.stops.length===1).map(entry=>entry.id))
  const representedPlaceIds=new Set([...data.activityTemplates.filter(entry=>entry.stops.length===1).flatMap(entry=>entry.stops.map(stop=>stop.placeId).filter((id):id is string=>Boolean(id))),...data.items.filter(item=>item.templateId&&singleTemplateIds.has(item.templateId)&&!item.parentId).map(item=>item.placeId)])
  const scheduledPlaceIds=new Set(data.items.map(item=>item.placeId))
  const places=data.places.filter(place=>(place.wantToVisit||(place.seeded&&!scheduledPlaceIds.has(place.id)))&&!representedPlaceIds.has(place.id)&&(!place.id.startsWith('template-wishlist-')||!templateIds.has(place.id.slice('template-wishlist-'.length))))
  const savePlace = async (values: EntryValues) => {
    const now=timestamp()
    if (!placeEditor) {
      if (values.dayId) {
        const place: Place={id:makeId(),name:values.name,stampKind:values.stampKind,address:values.address,googleMapsUrl:values.googleMapsUrl,notes:values.notes,wantToVisit:false,createdAt:now,updatedAt:now}
        const item: ItineraryItem={id:makeId(),dayId:values.dayId,placeId:place.id,stampKind:values.stampKind,parentId:values.parentId,time:values.time,bookingStatus:values.bookingStatus,notes:values.notes,visited:false,position:Date.now(),createdAt:now,updatedAt:now}
        const saved=await commit(()=>store.createItineraryPlace(place,item,values.cost));if(saved)setAdding(false);return saved
      }
      const saved=await commit(()=>store.addPlace({id:makeId(),name:values.name,stampKind:values.stampKind,address:values.address,googleMapsUrl:values.googleMapsUrl,notes:values.notes,wantToVisit:true,createdAt:now,updatedAt:now}));if(saved)setAdding(false);return saved
    }
    if (values.dayId) {
      const dayId = values.dayId
      const currentPlace = placeEditor
      const saved=await commit(()=>store.scheduleCandidatePlace(currentPlace.id,dayId,values.cost,{name:values.name,stampKind:values.stampKind,address:values.address,googleMapsUrl:values.googleMapsUrl,notes:values.notes},values));if(saved)setPlaceEditor(undefined);return saved
    }
    const saved=await commit(()=>store.updatePlace(placeEditor.id,{name:values.name,stampKind:values.stampKind,address:values.address,googleMapsUrl:values.googleMapsUrl,notes:values.notes,updatedAt:now}));if(saved)setPlaceEditor(undefined);return saved
  }
  const deletePlace = () => {
    const current = placeEditor
    if (!current || !confirm(`Delete ${current.name}?`)) return
    commit(()=>store.deletePlace(current.id)).then(saved=>saved&&setPlaceEditor(undefined))
  }
  const scheduleTemplate = async (values: EntryValues) => {
    if (!template) return false
    const currentTemplate = template
    if (!values.dayId) {
      const saved=await commit(()=>store.updateTemplate(currentTemplate.id,{name:values.name,stampKind:values.stampKind,description:values.notes??'',updatedAt:timestamp()}))
      if(saved)setTemplate(undefined)
      return saved
    }
    const dayId = values.dayId
    const saved=await commit(()=>store.materializeTemplate(currentTemplate,dayId,values.cost,{name:values.name,stampKind:values.stampKind,time:values.time,bookingStatus:values.bookingStatus,address:values.address,googleMapsUrl:values.googleMapsUrl,notes:values.notes,parentId:values.parentId}))
    if(saved)setTemplate(undefined)
    return saved
  }
  const deleteTemplate=()=>{const current=template;if(!current||!confirm(`Delete ${current.name} from Activities? Existing itinerary items remain.`))return;commit(()=>store.deleteTemplate(current.id)).then(saved=>saved&&setTemplate(undefined))}
  return <section className="page"><div className="section-row"><h2>Places <span className="count">{places.length}</span></h2><button className="icon-button add-button" aria-label="Add place" disabled={readOnly} onClick={()=>setAdding(true)}>+</button></div>
    <p className="list-label">Activities</p>{data.activityTemplates.map(entry=><button className="activity-card place-entry" key={entry.id} onClick={()=>setTemplate(entry)}><span className="thumb"><PlaceThumbnail name={entry.name}/></span><span className="card-copy"><h3>{entry.name}</h3><small>{entry.stops.length} {entry.stops.length===1?'activity':'stops'}</small></span><span className="chevron">›</span></button>)}
    <p className="list-label">Places</p>{places.map(place=><button className="activity-card place-entry" key={place.id} onClick={()=>setPlaceEditor(place)}><span className="thumb"><PlaceThumbnail name={place.name}/></span><span className="card-copy"><h3>{place.name}</h3>{place.notes&&<small>{place.notes}</small>}</span><span className="chevron">›</span></button>)}
    <Sheet open={adding} title="Add activity" onClose={()=>setAdding(false)}><ActivityForm data={data} busy={busy} onSave={savePlace}/></Sheet>
    <Sheet open={Boolean(placeEditor)} title="Edit activity" onClose={()=>setPlaceEditor(undefined)}><ActivityForm data={data} place={placeEditor} busy={busy} onSave={savePlace} onDelete={deletePlace}/></Sheet>
    <Sheet open={Boolean(template)} title="Activity" onClose={()=>setTemplate(undefined)}><ActivityForm data={data} fixedTemplate={template} busy={busy} onSave={scheduleTemplate} onDelete={deleteTemplate}/></Sheet>
  </section>
}

function Moments({ data, commit, busy, onOpen }: SectionProps & { onOpen: (itemId: string) => void }) {
  const store = useNotebookStore()
  const [editing, setEditing]=useState<Stamp>()
  const [photoStamp, setPhotoStamp]=useState<Stamp>()
  const photoFor=(stampId:string)=>data.photos.find(photo=>photo.stampId===stampId)
  const removeDetached=async(stamp:Stamp)=>{if(!confirm('Delete this memory and its photo permanently?'))return;const saved=await commit(()=>store.deleteDetachedMemory(stamp.id));if(saved)setEditing(undefined)}
  return <section className="page"><div className="section-row"><h2>Moments <span className="count">{data.stamps.length}</span></h2></div>{data.stamps.length?<div className="postcards">{data.stamps.map(stamp=>{const photo=photoFor(stamp.id);const item=stamp.itineraryItemId&&data.items.find(candidate=>candidate.id===stamp.itineraryItemId);return <MomentPostcard key={stamp.id} name={stamp.placeName} date={stamp.visitDate} stampKind={stamp.stampKind} caption={photo?.caption||formatDate(stamp.visitDate,false)} photo={photo?<PhotoImage photo={photo} alt={photo.caption||stamp.placeName}/>:undefined} onOpen={()=>item?onOpen(item.id):setEditing(stamp)}/>})}</div>:<p className="empty-compact">Stamp an activity to start your collection.</p>}
    {editing&&<Sheet open title="Moment" onClose={()=>setEditing(undefined)}><div className="detached-memory">{photoFor(editing.id)?<PhotoImage photo={photoFor(editing.id)!} alt={photoFor(editing.id)!.caption||editing.placeName} className="memory-image"/>:<PlaceScene name={editing.placeName} className="detached-scene"/>}<PostcardStamp name={editing.placeName} date={editing.visitDate} stampKind={editing.stampKind}/><p>{formatDate(editing.visitDate)}</p><button onClick={()=>{setPhotoStamp(editing);setEditing(undefined)}}>{photoFor(editing.id)?'Edit photo':'Add photo'}</button><button className="danger" onClick={()=>removeDetached(editing)}>Delete memory</button></div></Sheet>}
    {photoStamp&&<PhotoEditor open stamp={photoStamp} photo={photoFor(photoStamp.id)} busy={busy} commit={commit} onClose={()=>setPhotoStamp(undefined)}/>}
  </section>
}

function Costs({ data, commit, busy, onOpenSettings }: SectionProps & { onOpenSettings: () => void }) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const [editingId,setEditingId]=useState<string>()
  const [adding,setAdding]=useState(false)
  const editing=data.expenses.find(expense=>expense.id===editingId)
  const display=(data.metadata.find(entry=>entry.key==='displayCurrency')?.value??'KES') as Currency
  const activeRates=data.rateSets.find(rate=>rate.active)
  const totals=currencies.map(currency=>({currency,amount:data.expenses.filter(expense=>expense.currency===currency).reduce((sum,expense)=>sum+expense.amount,0)}))
  const convert=(expense:Expense,target:Currency)=>{const rates=data.rateSets.find(rate=>rate.id===expense.rateSetId);if(!rates)return;const keys:Record<Currency,keyof RateSet>={KES:'kesPerKes',USD:'kesPerUsd',ZAR:'kesPerZar'};return expense.amount*Number(rates[keys[expense.currency]])/Number(rates[keys[target]])}
  const close=()=>{setEditingId(undefined);setAdding(false)}
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);const now=timestamp();const expense:Expense={id:editing?.id??makeId(),amount:Number(fd.get('amount')),currency:String(fd.get('currency'))as Currency,date:editing?.itineraryItemId?editing.date:String(fd.get('date')),category:String(fd.get('category')).trim(),note:String(fd.get('note')).trim()||undefined,itineraryItemId:editing?.itineraryItemId,rateSetId:editing?.rateSetId??activeRates?.id,createdAt:editing?.createdAt??now,updatedAt:now};if(await commit(()=>store.saveExpense(expense)))close()}
  const remove=()=>editing&&confirm(editing.itineraryItemId?'Delete this expense? Its activity will no longer show a cost.':'Delete this expense?')&&commit(()=>store.deleteExpense(editing.id)).then(saved=>saved&&close())
  return <section className="page"><div className="section-row"><h2>Costs</h2><button className="icon-button add-button" aria-label="Add expense" disabled={readOnly} onClick={()=>setAdding(true)}>+</button></div>
    <div className="currency-tabs" role="group" aria-label="Display currency">{currencies.map(currency=><button key={currency} disabled={readOnly} aria-pressed={display===currency} onClick={()=>commit(()=>store.setDisplayCurrency(currency))}>{currency}</button>)}</div>
    <div className="total-card"><p>Original totals</p><strong>{money(totals.find(total=>total.currency===display)!.amount,display)}</strong><div className="original-totals">{totals.filter(total=>total.currency!==display).map(total=><small key={total.currency}>{money(total.amount,total.currency)}</small>)}</div></div>
    {!activeRates&&<div className="warning compact-warning"><span>Conversions off</span><button className="text-action" onClick={onOpenSettings}>Settings</button></div>}
    <div className="plain-list">{[...data.expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(expense=>{const equivalent=convert(expense,display);const linkedItem=data.items.find(item=>item.id===expense.itineraryItemId);const linkedPlace=linkedItem&&data.places.find(place=>place.id===linkedItem.placeId);return <button className="plain-row" key={expense.id} onClick={()=>setEditingId(expense.id)}><LineIcon name="costs"/><span className="copy"><strong>{linkedPlace?.name??expense.category}</strong><small>{equivalent!==undefined&&expense.currency!==display?`≈ ${money(equivalent,display)} · recorded rate`:expense.note||formatDate(expense.date)}</small></span><span className="amount">{money(expense.amount,expense.currency)}</span></button>})}</div>
    <Sheet open={adding||Boolean(editing)} title={editing?'Edit expense':'Add expense'} onClose={close}><form className="form-card" onSubmit={submit}>{editing?.itineraryItemId&&<p className="caption">{data.places.find(place=>place.id===data.items.find(item=>item.id===editing.itineraryItemId)?.placeId)?.name}</p>}<div className="fields-two"><label className="field">Amount *<input name="amount" type="number" min=".01" step=".01" required defaultValue={editing?.amount}/></label><label className="field">Currency<select name="currency" defaultValue={editing?.currency??'KES'}>{currencies.map(currency=><option key={currency}>{currency}</option>)}</select></label></div><div className="fields-two"><label className="field">{editing?.itineraryItemId?'Recorded date':'Date'}<input name="date" type="date" required readOnly={Boolean(editing?.itineraryItemId)} defaultValue={editing?.date??data.trip.startDate}/></label><label className="field">Category<input name="category" required defaultValue={editing?.category??''}/></label></div><label className="field">Note<input name="note" defaultValue={editing?.note}/></label><FormActions label="expense" busy={busy} onDelete={editing?remove:undefined}/></form></Sheet>
  </section>
}

function Settings({ data, commit, busy, onExport, onRestore, account, downloads }: SectionProps & { onExport: () => void; onRestore: (file: File) => void; account?: CloudAccountControls; downloads?: DownloadControls }) {
  const store = useNotebookStore()
  const readOnly = useReadOnly()
  const active=data.rateSets.find(rate=>rate.active)
  const example=data.rateSets[0]
  const canRestore=!readOnly && (store.kind==='local'||account?.role==='owner')
  return <div className="settings-stack">
    {downloads && <DownloadSettings controls={downloads}/>}
    <section className="settings-panel"><div className="settings-panel-heading"><span className="settings-symbol"><LineIcon name="costs"/></span><div><h3>Exchange rates</h3>{active&&<p className="rates-status">Manual rates active</p>}</div></div><fieldset className="sheet-readonly-fields" disabled={readOnly}><form className="form-card" onSubmit={async event=>{event.preventDefault();const fd=new FormData(event.currentTarget);await commit(()=>store.activateRateSet({id:makeId(),label:'Manual rates',effectiveDate:new Date().toISOString().slice(0,10),kesPerKes:1,kesPerUsd:Number(fd.get('usd')),kesPerZar:Number(fd.get('zar')),active:true,example:false,createdAt:timestamp()}))}}><div className="fields-two"><label className="field">KES per USD<input name="usd" type="number" min=".0001" step=".0001" required defaultValue={active?.kesPerUsd??example?.kesPerUsd}/></label><label className="field">KES per ZAR<input name="zar" type="number" min=".0001" step=".0001" required defaultValue={active?.kesPerZar??example?.kesPerZar}/></label></div><p className="caption">Manual rates · approximate conversions.</p><button className="save" disabled={busy || readOnly}>Activate rates</button></form></fieldset></section>
    <section className="settings-panel backup-panel"><div className="settings-panel-heading"><span className="settings-symbol"><LineIcon name="download"/></span><h3>Backups</h3></div><p className="caption">ZIP files include unencrypted trip data and photos.{store.kind==='cloud'&&account?.role==='editor'?' Only the owner can replace the shared notebook.':''}</p><div className="backup-actions"><button className="backup-export" onClick={onExport} disabled={busy}><LineIcon name="download"/>Export ZIP</button>{canRestore&&<label className="backup-restore"> <LineIcon name="restore"/>Restore<input type="file" accept=".zip,application/zip" onChange={event=>event.target.files?.[0]&&onRestore(event.target.files[0])}/></label>}</div></section>
    {account&&!readOnly&&<CloudAccountSettings account={account} commit={commit} busy={busy}/>}
  </div>
}

function CloudAccountSettings({ account, commit, busy }: { account: CloudAccountControls; commit: SectionProps['commit']; busy: boolean }) {
  const share = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('shareEmail')).trim()
    await commit(() => account.share(email), 'Shared access updated.')
  }
  return <section className="settings-panel access-panel">
    <div className="settings-panel-heading"><span className="settings-symbol"><LineIcon name="people"/></span><div><h3>Shared access</h3><p className="rates-status">{account.role === 'owner' ? 'Owner' : 'Editor'}</p></div></div>
    <p className="caption signed-in-email">{account.email}</p>
    {account.role==='owner'&&<>
      {account.claimedEmail?<div className="access-person"><span><strong>Shared with</strong><small>{account.claimedEmail}</small></span><button type="button" className="danger compact-action" disabled={busy} onClick={()=>{const userId=account.claimedUserId;if(userId&&confirm(`Remove access for ${account.claimedEmail}?`))void commit(()=>account.removeEditor(userId),'Traveller access removed.')}}>Remove</button></div>:
        <form className="form-card access-form" onSubmit={share}><label className="field">Second traveller’s email<input name="shareEmail" type="email" autoComplete="email" required defaultValue={account.pendingEmail??''}/></label><div className="sharing-actions">{account.pendingEmail&&<button type="button" className="ghost" disabled={busy} onClick={()=>commit(()=>account.revokePending(),'Pending access removed.')}>Revoke</button>}<button className="save" disabled={busy}>Share trip</button></div>{account.pendingEmail&&<p className="caption">Waiting for {account.pendingEmail} to sign in.</p>}</form>}
    </>}
    <button type="button" className="text-action sign-out-action" onClick={()=>account.signOut()} disabled={busy}>Sign out</button>
  </section>
}
