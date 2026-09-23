import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { NotebookApplication, TransientNotice } from './App'
import { db, initializeDatabase, loadData, materializeTemplate, scheduleCandidatePlace } from './db'
import { localNotebookStore } from './notebookStore'

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
})

it('lists itinerary children by time before their stored drag position', async () => {
  await initializeDatabase()
  await db.items.update('dated-item-arrival-waterfront-0', { time:'12:00', position:0 })
  await db.items.update('dated-item-arrival-waterfront-1', { time:'09:00', position:1 })
  await renderApp()
  const group = screen.getByRole('group', { name:'Arrival & V&A Waterfront stops' })
  const labels = within(group).getAllByRole('button').map(button => button.textContent)
  expect(labels[0]).toContain('Check in')
  expect(labels[1]).toContain('Arrive in Cape Town')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function renderApp() {
  render(<App clock={() => new Date('2026-09-21T08:00:00Z')}/>)
  await screen.findByRole('heading', { name: 'Capetown 2026' })
}

async function seedTour() {
  await initializeDatabase()
  const template = await db.activityTemplates.get('seed-template-cape-peninsula')
  if (!template) throw new Error('Missing peninsula template')
  return materializeTemplate(template, '2026-09-21')
}

describe('current itinerary focus', () => {
  beforeEach(async () => {
    await initializeDatabase()
    await db.items.update('dated-item-red-bus-mountain', { time: '09:00' })
    await db.items.update('dated-item-red-bus-mountain-0', { time: '09:15' })
    await db.places.add({ id:'place-current-second', name:'Afternoon plan', wantToVisit:false, createdAt:'', updatedAt:'' })
    await db.items.add({ id:'item-current-second', dayId:'2026-09-22', placeId:'place-current-second', time:'11:00', position:99, visited:false, createdAt:'', updatedAt:'' })
  })

  it('selects Cape Town today, marks one activity current and scrolls once', async () => {
    const notebook = await loadData()
    const scroll = vi.fn()
    const animation = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1 })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    render(<NotebookApplication store={localNotebookStore} initialData={notebook} clock={() => new Date('2026-09-22T08:00:00Z')}/>)
    expect(screen.getByRole('button', { name: /22/ })).toHaveAttribute('aria-pressed', 'true')
    const currentButtons = screen.getAllByRole('button', { current: 'time' })
    expect(currentButtons).toHaveLength(1)
    const parent = screen.getByRole('button', { name: /09:00.*Red Bus & Table Mountain/ })
    const firstStop = currentButtons[0]
    expect(parent).not.toHaveTextContent('Now')
    expect(parent).not.toHaveAttribute('aria-current')
    expect(parent.querySelector('time.activity-time')).toHaveTextContent('09:00')
    expect(parent.querySelector('time.activity-time')).toHaveAttribute('datetime', '09:00')
    expect(parent).not.toHaveTextContent('›')
    expect(firstStop).toHaveAccessibleName(/09:15.*Cape Town Red Bus/)
    expect(firstStop).not.toHaveTextContent('Now')
    expect(screen.queryByText('Now')).not.toBeInTheDocument()
    expect(firstStop.querySelector('time.route-time')).toHaveTextContent('09:15')
    expect(firstStop).not.toHaveTextContent('›')
    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    fireEvent.click(screen.getByRole('button', { name: /23/ }))
    fireEvent.click(screen.getByRole('button', { name: /22/ }))
    expect(scroll).toHaveBeenCalledOnce()
    animation.mockRestore()
  })

  it('keeps the parent current only until its first timed child starts', async () => {
    const notebook = await loadData()
    render(<NotebookApplication store={localNotebookStore} initialData={notebook} clock={() => new Date('2026-09-22T07:05:00Z')}/>)
    const current = screen.getByRole('button', { current: 'time' })
    expect(current).toHaveTextContent('Red Bus & Table Mountain')
    expect(current).not.toHaveTextContent('Now')
    expect(screen.getByRole('button', { name: /09:15.*Cape Town Red Bus/ })).not.toHaveAttribute('aria-current')
  })

  it('updates at a start boundary and on visibility without stealing the selected day', async () => {
    let now = new Date('2026-09-22T08:59:10Z')
    const notebook = await loadData()
    render(<NotebookApplication store={localNotebookStore} initialData={notebook} clock={() => now}/>)
    expect(screen.getAllByRole('button', { current: 'time' })).toHaveLength(1)
    expect(screen.getByRole('button', { current: 'time' })).toHaveTextContent('Cape Town Red Bus')
    now = new Date('2026-09-22T09:00:00Z')
    act(() => window.dispatchEvent(new Event('focus')))
    expect(screen.getByRole('button', { current: 'time' })).toHaveTextContent('Afternoon plan')
    fireEvent.click(screen.getByRole('button', { name: /23/ }))
    now = new Date('2026-09-23T22:01:00Z')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.getByRole('button', { name: /23/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('computes the same current marker in a downloaded read-only copy', async () => {
    const notebook = await loadData()
    const store = { ...localNotebookStore, kind: 'download' as const, readOnly: true }
    render(<NotebookApplication store={store} initialData={notebook} clock={() => new Date('2026-09-22T08:00:00Z')}/>)
    expect(screen.getAllByRole('button', { current: 'time' })).toHaveLength(1)
    expect(screen.getByText('Offline copy · read-only')).toBeInTheDocument()
  })
})

describe('transient success notices', () => {
  it('dismisses after 20 seconds', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    render(<TransientNotice message="Saved" version={1} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(19_999))
    expect(dismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('resets for repeated text and replacements', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const { rerender } = render(<TransientNotice message="Saved" version={1} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(10_000))
    rerender(<TransientNotice message="Saved" version={2} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(10_000))
    expect(dismiss).not.toHaveBeenCalled()
    rerender(<TransientNotice message="Moved" version={3} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(20_000))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('dismisses error messages after 20 seconds and exposes them as alerts', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    render(<TransientNotice message="DataCloneError" version={1} tone="error" onDismiss={dismiss}/>)
    expect(screen.getByRole('alert')).toHaveTextContent('DataCloneError')
    act(() => vi.advanceTimersByTime(19_999))
    expect(dismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(dismiss).toHaveBeenCalledOnce()
  })
})

describe('whole-app navigation and settings', () => {
  it('uses the approved five-tab order and Moments name', async () => {
    await renderApp()
    const nav = screen.getByRole('navigation', { name: 'Notebook sections' })
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['Itinerary','Places','Moments','Checklist','Costs'])
    expect(screen.queryByText('Stamps')).not.toBeInTheDocument()
  })

  it('opens settings with only exchange-rate and backup cards', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('heading', { name: 'Exchange rates' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Backups' })).toBeInTheDocument()
    expect(within(dialog).queryByText('Trip')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Export ZIP' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Restore')).toBeInTheDocument()
  })

  it('returns focus to the settings button after Escape', async () => {
    await renderApp()
    const opener = screen.getByRole('button', { name: 'Open settings' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})

describe('itinerary timeline and detail context', () => {
  it('uses colored symbols on cards while keeping the wide detail scene', async () => {
    await seedTour()
    await renderApp()
    const tour = screen.getByRole('button', { name: /Cape Peninsula Tour.*stops/ })
    expect(tour.querySelector('.thumb [data-thumbnail="cape"]')).not.toBeNull()
    expect(tour.querySelector('.thumb [data-scene]')).toBeNull()
    fireEvent.click(tour)
    expect(document.querySelector('.hero [data-scene="cape"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Itinerary' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Notebook sections' })).getByRole('button', { name: 'Places' }))
    const thumbnails = document.querySelectorAll('.place-entry .thumb')
    expect(thumbnails.length).toBeGreaterThan(0)
    for (const thumbnail of thumbnails) {
      expect(thumbnail.querySelector('[data-thumbnail]')).not.toBeNull()
      expect(thumbnail.querySelector('[data-scene]')).toBeNull()
    }
  })

  it('shows all tour stops in the compact itinerary timeline by default', async () => {
    await seedTour()
    await renderApp()
    const group = screen.getByRole('group', { name: 'Cape Peninsula Tour stops' })
    expect(within(group).getAllByRole('button')).toHaveLength(9)
    expect(within(group).getByRole('button', { name: /New Cape Point Lighthouse/ })).toBeInTheDocument()
    expect(screen.queryByText('The route')).not.toBeInTheDocument()
    expect(screen.queryByText('More')).not.toBeInTheDocument()
  })

  it('returns a child opened from the overview to the overview', async () => {
    await seedTour()
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Bo-Kaap/ }))
    expect(screen.getByRole('heading', { name: 'Bo-Kaap' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Itinerary' }))
    expect(screen.getByRole('heading', { name: 'Itinerary' })).toBeInTheDocument()
  })

  it('returns a child opened inside a parent detail to that parent', async () => {
    await seedTour()
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Cape Peninsula Tour/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bo-Kaap/ }))
    expect(screen.getByRole('heading', { name: 'Bo-Kaap' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cape Peninsula Tour' }))
    expect(screen.getByRole('heading', { name: 'Cape Peninsula Tour' })).toBeInTheDocument()
  })

  it('stamps one child independently, adds its Moment, and only animates the new stamp', async () => {
    const parent = await seedTour()
    const children = await db.items.where('parentId').equals(parent.id).toArray()
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Bo-Kaap/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Stamp this visit' }))
    await waitFor(() => expect(document.querySelector('.hero-stamp')).toHaveClass('stamp-pop'))
    expect((await db.items.get(parent.id))?.visited).toBe(false)
    expect((await db.items.get(children.find(child => child.placeId === 'seed-place-bo-kaap')!.id))?.visited).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Itinerary' }))
    fireEvent.click(screen.getByRole('button', { name: /Bo-Kaap/ }))
    expect(document.querySelector('.hero-stamp')).not.toHaveClass('stamp-pop')
    fireEvent.click(screen.getByRole('button', { name: 'Itinerary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Moments' }))
    expect(screen.getByRole('button', { name: /Bo-Kaap/ })).toBeInTheDocument()
    expect(screen.queryByText('VISITED')).not.toBeInTheDocument()
    expect(document.querySelector('.postcard-stamp .stamp-name')?.textContent).toBe('BO-KAAP')
    fireEvent.click(screen.getByRole('button', { name: /Bo-Kaap/ }))
    expect(document.querySelector('.hero [data-scene="house"]')).not.toBeNull()
  })

  it('preserves detached memory actions and recorded dates with the full-name panel', async () => {
    await initializeDatabase()
    const name = 'Café, São Tomé & Kaapstad — 海辺の散歩 🌊'
    const stamp = { id: 'detached-review', placeName: name, visitDate: '2026-09-24', detached: true, createdAt: new Date().toISOString() }
    await db.stamps.add(stamp)
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Moments' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    const dialog = screen.getByRole('dialog', { name: 'Moment' })
    expect(dialog.querySelector('.stamp-name')?.textContent).toBe(name.toUpperCase())
    expect(within(dialog).queryByText('VISITED')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add photo' })).toBeInTheDocument()
    expect(await db.stamps.get(stamp.id)).toEqual(stamp)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete memory' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.stamps.get(stamp.id)).toBeUndefined()
  })
})

describe('unified activity form', () => {
  it('saves a selected stamp for a custom activity and uses its own name in Moments', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })
    fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'Our sunset picnic' } })
    fireEvent.change(within(dialog).getByLabelText('Link'), { target: { value: 'https://www.getyourguide.com/cape-town-l103/example-t123/' } })
    fireEvent.click(within(dialog).getByText('Choose a design'))
    expect(within(dialog).getByRole('radio', { name: 'Default' })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Lighthouse' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const place = await db.places.filter(candidate => candidate.name === 'Our sunset picnic').first()
    const item = await db.items.where('placeId').equals(place!.id).first()
    expect(item?.stampKind).toBe('lighthouse')
    expect(item?.linkUrl).toBe('https://www.getyourguide.com/cape-town-l103/example-t123/')
    fireEvent.click(screen.getByRole('button', { name: /Our sunset picnic/ }))
    expect(screen.getByRole('link', { name: 'Open on GetYourGuide' })).toHaveAttribute('href', item?.linkUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Stamp this visit' }))
    await waitFor(() => expect(document.querySelector('.hero-stamp > svg')).toHaveAttribute('data-stamp-kind', 'lighthouse'))
    fireEvent.click(screen.getByRole('button', { name: 'Itinerary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Moments' }))
    const postcard = screen.getByRole('button', { name: /Our sunset picnic travel stamp/ })
    expect(postcard.querySelector('.stamp-name')?.textContent).toBe('OUR SUNSET PICNIC')
    expect(postcard.querySelector('[data-stamp-kind]')).toHaveAttribute('data-stamp-kind', 'lighthouse')
    fireEvent.click(postcard)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByText('Choose a design'))
    fireEvent.click(screen.getByRole('radio', { name: 'Default' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.querySelector('.hero-stamp > svg')).toHaveAttribute('data-stamp-kind', 'pin')
    expect(await db.stamps.where('itineraryItemId').equals(item!.id).first()).toMatchObject({
      placeName: 'Our sunset picnic', visitDate: '2026-09-21', stampKind: 'pin',
    })
  })

  it('keeps a stamp selection as a draft when an edit fails, and cancel leaves it unchanged', async () => {
    await seedTour()
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /Bo-Kaap/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit activity' })
    fireEvent.click(within(dialog).getByText('Choose a design'))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Penguins' }))
    vi.spyOn(localNotebookStore, 'saveItineraryDetails').mockRejectedValueOnce({ message: 'Save rejected by server', code: '42501' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save activity' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved')
    expect(within(dialog).getByRole('radio', { name: 'Penguins' })).toBeChecked()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByText('Choose a design'))
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked()
  })

  it('remembers the chosen design for an unscheduled place and when scheduling it', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Places' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add place' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Our favourite cafe' } })
    fireEvent.click(screen.getByText('Choose a design'))
    fireEvent.click(screen.getByRole('radio', { name: 'Bo-Kaap' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const saved = await db.places.filter(place => place.name === 'Our favourite cafe').first()
    expect(saved).toMatchObject({ stampKind: 'house', wantToVisit: true })
    fireEvent.click(screen.getByRole('button', { name: /Our favourite cafe/ }))
    fireEvent.click(screen.getByText('Choose a design'))
    expect(screen.getByRole('radio', { name: 'Bo-Kaap' })).toBeChecked()
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-09-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.items.where('placeId').equals(saved!.id).first()).toMatchObject({ stampKind: 'house' })
    expect(await db.places.get(saved!.id)).toMatchObject({ wantToVisit: false })
  })

  it('saves a design on an activity template without scheduling it', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Places' }))
    fireEvent.click(screen.getByRole('button', { name: /Table Mountain.*activity/ }))
    fireEvent.click(screen.getByText('Choose a design'))
    fireEvent.click(screen.getByRole('radio', { name: 'Cape cliffs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.activityTemplates.get('seed-template-table-mountain')).toMatchObject({ stampKind: 'cliff' })
  })

  it('shows every approved field and only requires Name', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })
    for (const label of ['Name *','Parent activity','Day','Time','Link','Cost','Currency','Booking status','Notes']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
    expect(within(dialog).queryByLabelText('Address')).not.toBeInTheDocument()
    expect(dialog.querySelectorAll('input[type="url"]')).toHaveLength(1)
    const metaRow = within(dialog).getByLabelText('Parent activity').closest('.activity-meta-row')
    expect(metaRow).toContainElement(within(dialog).getByLabelText('Booking status'))
    expect(metaRow?.querySelector('.stamp-picker')).toBeNull()
    const fields = within(dialog).getAllByRole('textbox').concat(within(dialog).getAllByRole('combobox')).concat(within(dialog).getAllByRole('spinbutton'))
    expect(fields.filter(field => field.hasAttribute('required'))).toEqual([within(dialog).getByLabelText('Name *')])
    expect(within(dialog).getByRole('button', { name: 'Save activity' })).toHaveAttribute('title', 'Save activity')
    expect(within(dialog).queryByRole('button', { name: 'Delete activity' })).not.toBeInTheDocument()
  })

  it('creates one real linked cost and closes only after commit', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Winelands day' } })
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '1250' } })
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'ZAR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const place = await db.places.filter(candidate => candidate.name === 'Winelands day').first()
    const item = place && await db.items.where('placeId').equals(place.id).first()
    expect(await db.expenses.where('itineraryItemId').equals(item!.id).toArray()).toHaveLength(1)
  })

  it('retains every field when the atomic write fails', async () => {
    await renderApp()
    vi.spyOn(db.items, 'add').mockRejectedValueOnce(new Error('Activity write failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Draft day' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Keep this draft' } })
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'))
    expect(screen.getByRole('dialog', { name: 'Add activity' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name *')).toHaveValue('Draft day')
    expect(screen.getByLabelText('Notes')).toHaveValue('Keep this draft')
    expect(screen.getByLabelText('Cost')).toHaveValue(500)
  })

  it('offers same-day parent assignment and delete beside save when editing', async () => {
    await initializeDatabase()
    const createdAt = new Date().toISOString()
    await db.places.add({ id:'parent-place',name:'Peninsula day',wantToVisit:false,createdAt,updatedAt:createdAt })
    await db.items.add({ id:'parent-item',dayId:'2026-09-21',placeId:'parent-place',visited:false,position:1,createdAt,updatedAt:createdAt })
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    expect(screen.getByRole('option', { name: 'Peninsula day' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /Peninsula day/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit activity' })
    expect(within(dialog).getByRole('button', { name: 'Delete activity' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save activity' })).toBeInTheDocument()
  })
})

describe('remaining production surfaces', () => {
  it('keeps activity-backed Places cards unique', async () => {
    await initializeDatabase()
    const createdAt = new Date().toISOString()
    await db.places.add({id:'template-wishlist-seed-template-red-bus',name:'Cape Town Red Bus / Hop-On Hop-Off',wantToVisit:true,createdAt,updatedAt:createdAt})
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Places' }))
    expect(screen.getAllByRole('heading', { name: 'Table Mountain' })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: 'Cape Town Red Bus / Hop-On Hop-Off' })).toHaveLength(1)
  })

  it('edits checklist reminders in an icon-action sheet', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Checklist' }))
    expect(screen.queryByText('Preparation')).not.toBeInTheDocument()
    expect(screen.queryByText('Create an offline backup')).not.toBeInTheDocument()
    expect(screen.getAllByRole('group').map(section => section.querySelector('summary')?.textContent)).toEqual([
      'Planning1 item · 0 done','Documents2 items · 0 done','Shopping3 items · 0 done',
    ])
    expect(screen.getByText('Shopping')).toBeInTheDocument()
    expect(screen.getByText('Sneakers', { selector:'strong' })).toBeInTheDocument()
    expect(screen.getByText('Golf stuff', { selector:'strong' })).toBeInTheDocument()
    expect(screen.getByText("Kids' clothes", { selector:'strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Shopping', { selector:'strong' }))
    expect(screen.queryByText('Sneakers', { selector:'strong' })).not.toBeVisible()
    fireEvent.click(screen.getByText('Shopping', { selector:'strong' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))
    expect(screen.getByRole('dialog', { name:'Add reminder' }).closest('[inert]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Reminder *'), { target: { value: 'Confirm museum day' } })
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Planning')
    fireEvent.change(screen.getByLabelText('Category'), { target: { value:'Documents' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.checklist.filter(item => item.title === 'Confirm museum day').first()).toMatchObject({ category:'Documents' })
  })

  it('keeps a linked expense recorded date immutable from Costs', async () => {
    await initializeDatabase()
    const item = await scheduleCandidatePlace('seed-place-table-mountain','2026-09-22',{amount:100,currency:'KES'})
    const original = (await db.expenses.where('itineraryItemId').equals(item.id).first())!
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Costs' }))
    expect(screen.getByRole('group', { name: 'Display currency' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Table Mountain/ }))
    const date = screen.getByLabelText('Recorded date')
    expect(date).toHaveAttribute('readonly')
    fireEvent.change(date,{target:{value:'2026-09-28'}})
    fireEvent.change(screen.getByLabelText('Amount *'),{target:{value:'150'}})
    fireEvent.click(screen.getByRole('button',{name:'Save expense'}))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.expenses.get(original.id)).toMatchObject({date:'2026-09-22',amount:150})
  })

  it('shows one KES trip total using each expense recorded rate snapshot', async () => {
    await initializeDatabase()
    const createdAt = new Date().toISOString()
    await db.rateSets.bulkAdd([
      { id:'rates-a',label:'Recorded A',effectiveDate:'2026-09-20',kesPerKes:1,kesPerUsd:130,kesPerZar:7,active:false,example:false,createdAt },
      { id:'rates-b',label:'Recorded B',effectiveDate:'2026-09-21',kesPerKes:1,kesPerUsd:140,kesPerZar:8,active:false,example:false,createdAt },
    ])
    await db.expenses.bulkAdd([
      { id:'kes-cost',amount:1000,currency:'KES',date:'2026-09-21',category:'Transport',createdAt,updatedAt:createdAt },
      { id:'usd-cost',amount:10,currency:'USD',date:'2026-09-22',category:'Activity',rateSetId:'rates-a',createdAt,updatedAt:createdAt },
      { id:'zar-cost',amount:100,currency:'ZAR',date:'2026-09-23',category:'Food',rateSetId:'rates-b',createdAt,updatedAt:createdAt },
      { id:'missing-rate',amount:5,currency:'USD',date:'2026-09-24',category:'Other',createdAt,updatedAt:createdAt },
    ])
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name:'Costs' }))
    const total = screen.getByText('Trip total in KES').closest('.total-card') as HTMLElement
    expect(within(total).getByText(/3,100/)).toBeInTheDocument()
    expect(within(total).getByText('Ksh 1,000.00')).toBeInTheDocument()
    expect(within(total).getByText('US$15.00')).toBeInTheDocument()
    expect(within(total).getByText(/ZAR\s*100\.00/)).toBeInTheDocument()
    expect(within(total).getByRole('alert')).toHaveTextContent('1 foreign expense is not included')
    expect(document.querySelector('.expense-list svg')).not.toBeInTheDocument()
  })
})

describe('form persistence and cancellation', () => {
  it('cancels drafts from each primary form without writing them', async () => {
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name:'Add activity' }))
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Name *'), { target:{ value:'Cancelled itinerary activity' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Add activity' }))

    fireEvent.click(screen.getByRole('button', { name:'Places' }))
    fireEvent.click(screen.getByRole('button', { name:'Add place' }))
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Name *'), { target:{ value:'Cancelled place' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Add activity' }))

    fireEvent.click(screen.getByRole('button', { name:'Checklist' }))
    fireEvent.click(screen.getByRole('button', { name:'Add reminder' }))
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Reminder *'), { target:{ value:'Cancelled reminder' } })
    fireEvent.click(screen.getByRole('button', { name:'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name:'Costs' }))
    fireEvent.click(screen.getByRole('button', { name:'Add expense' }))
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Amount *'), { target:{ value:'900' } })
    fireEvent.change(screen.getByLabelText('Category'), { target:{ value:'Cancelled cost' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Add expense' }))

    fireEvent.click(screen.getByRole('button', { name:'Open settings' }))
    fireEvent.change(screen.getByLabelText('KES per USD'), { target:{ value:'999' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Settings' }))

    expect(await db.places.filter(place => place.name.startsWith('Cancelled')).count()).toBe(0)
    expect(await db.checklist.filter(item => item.title.startsWith('Cancelled')).count()).toBe(0)
    expect(await db.expenses.filter(expense => expense.category.startsWith('Cancelled')).count()).toBe(0)
    expect(await db.rateSets.filter(rate => rate.active).count()).toBe(0)
  })

  it('saves place, expense, template schedule, and exchange-rate forms', async () => {
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name:'Places' }))
    fireEvent.click(screen.getByRole('button', { name:'Add place' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target:{ value:'Zeitz MOCAA' } })
    fireEvent.click(screen.getByRole('button', { name:'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.places.filter(place => place.name === 'Zeitz MOCAA' && place.wantToVisit).count()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name:/Cape Peninsula Tour/ }))
    fireEvent.change(screen.getByLabelText('Day'), { target:{ value:'2026-09-21' } })
    fireEvent.click(screen.getByRole('button', { name:'Save activity' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await db.items.toArray()).filter(item => item.templateId === 'seed-template-cape-peninsula')).toHaveLength(10)

    fireEvent.click(screen.getByRole('button', { name:'Costs' }))
    fireEvent.click(screen.getByRole('button', { name:'Add expense' }))
    fireEvent.change(screen.getByLabelText('Amount *'), { target:{ value:'900' } })
    fireEvent.change(screen.getByLabelText('Category'), { target:{ value:'Transport' } })
    fireEvent.click(screen.getByRole('button', { name:'Save expense' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await db.expenses.filter(expense => expense.amount === 900 && expense.category === 'Transport').count()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name:'Open settings' }))
    fireEvent.change(screen.getByLabelText('KES per USD'), { target:{ value:'130' } })
    fireEvent.change(screen.getByLabelText('KES per ZAR'), { target:{ value:'7.1' } })
    fireEvent.click(screen.getByRole('button', { name:'Activate rates' }))
    await waitFor(async () => expect(await db.rateSets.filter(rate => rate.active).count()).toBe(1))
    expect(await db.rateSets.filter(rate => rate.active && rate.kesPerUsd === 130 && rate.kesPerZar === 7.1).count()).toBe(1)
  })

  it('shows accessible save progress and blocks duplicate form submission', async () => {
    await initializeDatabase()
    const next = await loadData()
    let resolve!: (value: typeof next) => void
    const pending = new Promise<typeof next>(done => { resolve = done })
    const save = vi.spyOn(localNotebookStore, 'saveExpense').mockReturnValue(pending)
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name:'Costs' }))
    fireEvent.click(screen.getByRole('button', { name:'Add expense' }))
    fireEvent.change(screen.getByLabelText('Amount *'), { target:{ value:'900' } })
    fireEvent.change(screen.getByLabelText('Category'), { target:{ value:'Transport' } })
    fireEvent.click(screen.getByRole('button', { name:'Save expense' }))
    const saving = screen.getByRole('button', { name:'Saving…' })
    expect(saving).toBeDisabled()
    expect(saving).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(saving)
    expect(save).toHaveBeenCalledOnce()
    await act(async () => resolve(next))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('saves and cancels the Moment photo form without losing the stored photo', async () => {
    await initializeDatabase()
    const item = (await db.items.where('dayId').equals('2026-09-21').toArray()).find(candidate => candidate.parentId)!
    const place = (await db.places.get(item.placeId))!
    const createdAt = new Date().toISOString()
    await db.items.update(item.id, { visited:true })
    await db.stamps.add({ id:'photo-stamp', itineraryItemId:item.id, placeName:place.name, visitDate:'2026-09-21', detached:false, createdAt })
    await db.photos.add({ id:'photo-entry', stampId:'photo-stamp', caption:'Original caption', mimeType:'image/jpeg', width:100, height:100, size:3, blob:new Blob(['jpg'], { type:'image/jpeg' }), createdAt, updatedAt:createdAt })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-photo')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name:'Moments' }))
    fireEvent.click(screen.getByRole('button', { name: accessibleName => accessibleName.includes(`${place.name} travel stamp`) }))
    const momentsSection = screen.getByRole('heading', { name:'Moments' }).closest('section')!
    fireEvent.click(within(momentsSection).getByRole('button', { name:'Edit' }))
    fireEvent.change(screen.getByLabelText('Caption'), { target:{ value:'Saved caption' } })
    fireEvent.click(screen.getByRole('button', { name:'Save photo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await db.photos.get('photo-entry'))?.caption).toBe('Saved caption')

    fireEvent.click(within(screen.getByRole('heading', { name:'Moments' }).closest('section')!).getByRole('button', { name:'Edit' }))
    fireEvent.change(screen.getByLabelText('Caption'), { target:{ value:'Cancelled caption' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Moment' }))
    expect((await db.photos.get('photo-entry'))?.caption).toBe('Saved caption')
  })
})
