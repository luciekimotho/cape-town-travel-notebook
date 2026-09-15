import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db'

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
})
afterEach(cleanup)

async function openChecklist() {
  render(<App />)
  await screen.findByText('Trip planner')
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
