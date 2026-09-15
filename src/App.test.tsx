import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App, { TransientNotice } from './App'
import { db, initializeDatabase, scheduleCandidatePlace } from './db'

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('transient success notices', () => {
  it('stays visible until 20 seconds and then dismisses', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    render(<TransientNotice message="Saved" version={1} onDismiss={dismiss}/>)

    act(() => vi.advanceTimersByTime(19_999))
    expect(dismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('resets the timer for replacements and repeated text', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const { rerender } = render(<TransientNotice message="Saved" version={1} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(10_000))
    rerender(<TransientNotice message="Saved" version={2} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(10_000))
    expect(dismiss).not.toHaveBeenCalled()
    rerender(<TransientNotice message="Moved" version={3} onDismiss={dismiss}/>)
    act(() => vi.advanceTimersByTime(19_999))
    expect(dismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(dismiss).toHaveBeenCalledOnce()
  })
})

async function openChecklist() {
  render(<App />)
  await screen.findByRole('heading', { name: 'Trip' })
  fireEvent.click(screen.getByRole('button', { name: 'checklist' }))
  return screen.findByRole('button', { name: '+ Add reminder' })
}

describe('checklist form sheet', () => {
  it('opens from the Add action and cancels with focus returned', async () => {
    const opener = await openChecklist()
    opener.focus()
    fireEvent.click(opener)

    expect(screen.getByRole('dialog', { name: 'Add a reminder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Task')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('closes only after a successful committed save', async () => {
    const opener = await openChecklist()
    fireEvent.click(opener)
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Reserve airport transfer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await db.checklist.toArray()).some(item => item.title === 'Reserve airport transfer')).toBe(true)
  })

  it('preserves the draft and sheet when persistence fails', async () => {
    const opener = await openChecklist()
    fireEvent.click(opener)
    vi.spyOn(db.checklist, 'put').mockRejectedValueOnce(new Error('Storage unavailable'))
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Test failure' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable'))
    expect(screen.getByRole('dialog', { name: 'Add a reminder' })).toBeInTheDocument()
    expect(screen.getByLabelText('Task')).toHaveValue('Test failure')
    expect(screen.queryByText('Checklist saved.')).not.toBeInTheDocument()
    expect((await db.checklist.toArray()).some(item => item.title === 'Test failure')).toBe(false)
    vi.useFakeTimers()
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable')
  })

  it('keeps secondary record actions in a keyboard-operable disclosure', async () => {
    await openChecklist()
    const summary = screen.getAllByText('More')[0]
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')

    fireEvent.click(summary)

    expect(details).toHaveAttribute('open')
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
  })
})

describe('shared itinerary entry form', () => {
  async function openEntry() {
    render(<App />)
    await screen.findByText('Trip')
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }))
    return screen.getByRole('dialog', { name: /Add to/ })
  }

  it('creates a standalone activity and exactly one linked real expense', async () => {
    await openEntry()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Winelands day' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1250' } })
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'ZAR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to day' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const place = await db.places.filter(candidate => candidate.name === 'Winelands day').first()
    const item = place && await db.items.where('placeId').equals(place.id).first()
    expect(item?.parentId).toBeUndefined()
    const linked = await db.expenses.where('itineraryItemId').equals(item!.id).toArray()
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ amount: 1250, currency: 'ZAR', category: 'Activity' })
  })

  it('attaches a new activity to an eligible existing parent', async () => {
    await initializeDatabase()
    const createdAt = new Date().toISOString()
    await db.places.add({ id: 'parent-place', name: 'Peninsula day', wantToVisit: false, createdAt, updatedAt: createdAt })
    await db.items.add({ id: 'parent-item', dayId: '2026-09-21', placeId: 'parent-place', visited: false, position: 1, createdAt, updatedAt: createdAt })
    await openEntry()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cape Point' } })
    fireEvent.change(screen.getByLabelText('Parent activity'), { target: { value: 'parent-item' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to day' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const childPlace = await db.places.filter(candidate => candidate.name === 'Cape Point').first()
    const child = childPlace && await db.items.where('placeId').equals(childPlace.id).first()
    expect(child?.parentId).toBe('parent-item')
    expect((await db.items.get('parent-item'))?.isActivityGroup).toBe(true)
  })

  it('retains every draft when the atomic write fails', async () => {
    await openEntry()
    vi.spyOn(db.items, 'add').mockRejectedValueOnce(new Error('Activity write failed'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft day' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Keep this draft' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to day' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Activity write failed'))
    expect(screen.getByRole('dialog', { name: /Add to/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Draft day')
    expect(screen.getByLabelText('Notes')).toHaveValue('Keep this draft')
    expect(screen.getByLabelText('Amount')).toHaveValue(500)
    expect(await db.places.filter(candidate => candidate.name === 'Draft day').count()).toBe(0)
    expect(await db.expenses.count()).toBe(0)
  })
})

describe('places and settings navigation', () => {
  it('merges saved and seeded places without duplicate navigation or cards', async () => {
    await initializeDatabase()
    const createdAt = new Date().toISOString()
    await db.places.add({ id: 'custom-place', name: 'Kirstenbosch', wantToVisit: true, createdAt, updatedAt: createdAt })
    await db.places.add({ id: 'template-wishlist-seed-template-red-bus', name: 'Cape Town Red Bus / Hop-On Hop-Off', wantToVisit: true, createdAt, updatedAt: createdAt })
    await db.places.update('seed-place-bo-kaap', { wantToVisit: true })
    render(<App />)
    await screen.findByText('Trip')
    fireEvent.click(screen.getByRole('button', { name: 'places' }))

    expect(screen.queryByRole('button', { name: 'ideas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /want to visit/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Bo-Kaap' })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: 'Table Mountain' })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: 'Cape Town Red Bus / Hop-On Hop-Off' })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Kirstenbosch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add place' })).toBeInTheDocument()
  })

  describe('linked expense editing', () => {
    it('keeps the recorded activity date immutable from Costs', async () => {
      await initializeDatabase()
      const item = await scheduleCandidatePlace('seed-place-table-mountain', '2026-09-22', { amount:100, currency:'KES' })
      const original = (await db.expenses.where('itineraryItemId').equals(item.id).first())!
      render(<App />)
      await screen.findByText('Trip')
      fireEvent.click(screen.getByRole('button', { name: /Costs/ }))
      fireEvent.click(await screen.findByText('More'))
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      const date = screen.getByLabelText('Recorded date')
      expect(date).toHaveAttribute('readonly')
      fireEvent.change(date, { target: { value: '2026-09-28' } })
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '150' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await db.expenses.get(original.id)).toMatchObject({ date:'2026-09-22', amount:150 })
    })
  })

  it('opens practical settings from the header without a More navigation tab', async () => {
    render(<App />)
    await screen.findByText('Trip')
    expect(screen.queryByRole('button', { name: /More/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Trip', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Exchange rates')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export ZIP' })).toBeInTheDocument()
  })
})
