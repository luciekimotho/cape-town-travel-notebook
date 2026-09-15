import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { TransientNotice } from './App'
import { db, initializeDatabase, materializeTemplate, scheduleCandidatePlace } from './db'

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function renderApp() {
  render(<App />)
  await screen.findByRole('heading', { name: 'Capetown 2026' })
}

async function seedTour() {
  await initializeDatabase()
  const template = await db.activityTemplates.get('seed-template-cape-peninsula')
  if (!template) throw new Error('Missing peninsula template')
  return materializeTemplate(template, '2026-09-21')
}

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
  })
})

describe('unified activity form', () => {
  it('shows every approved field and only requires Name', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    const dialog = screen.getByRole('dialog', { name: 'Add activity' })
    for (const label of ['Name *','Parent activity','Day','Time','Cost','Currency','Booking status','Address','Google Maps URL','Notes']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
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
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Activity write failed'))
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
      'Planning0/1','Documents0/2','Shopping0/3',
    ])
    expect(screen.getByText('Shopping')).toBeInTheDocument()
    expect(screen.getByText('Sneakers', { selector:'strong' })).toBeInTheDocument()
    expect(screen.getByText('Golf stuff', { selector:'strong' })).toBeInTheDocument()
    expect(screen.getByText("Kids' clothes", { selector:'strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Shopping', { selector:'strong' }))
    expect(screen.queryByText('Sneakers', { selector:'strong' })).not.toBeVisible()
    fireEvent.click(screen.getByText('Shopping', { selector:'strong' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))
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
})

describe('form persistence and cancellation', () => {
  it('cancels drafts from each primary form without writing them', async () => {
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name:'Add activity' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target:{ value:'Cancelled itinerary activity' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Add activity' }))

    fireEvent.click(screen.getByRole('button', { name:'Places' }))
    fireEvent.click(screen.getByRole('button', { name:'Add place' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target:{ value:'Cancelled place' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Add activity' }))

    fireEvent.click(screen.getByRole('button', { name:'Checklist' }))
    fireEvent.click(screen.getByRole('button', { name:'Add reminder' }))
    fireEvent.change(screen.getByLabelText('Reminder *'), { target:{ value:'Cancelled reminder' } })
    fireEvent.click(screen.getByRole('button', { name:'Close Add reminder' }))

    fireEvent.click(screen.getByRole('button', { name:'Costs' }))
    fireEvent.click(screen.getByRole('button', { name:'Add expense' }))
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
    fireEvent.click(screen.getAllByRole('button').find(button => button.textContent?.includes(place.name))!)
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
