import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('persistence failure handling', () => {
  it('shows the write error and does not report success', async () => {
    render(<App />)
    await screen.findByText('Trip planner')
    fireEvent.click(screen.getByRole('button', { name:'checklist' }))
    await screen.findByText('Add a reminder')
    vi.spyOn(db.checklist, 'put').mockRejectedValueOnce(new Error('Storage unavailable'))
    fireEvent.change(screen.getByLabelText('Task'), { target:{ value:'Test failure' } })
    fireEvent.submit(screen.getByText('Save reminder').closest('form')!)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable'))
    expect(screen.queryByText('Checklist saved.')).not.toBeInTheDocument()
    expect((await db.checklist.toArray()).some(item => item.title === 'Test failure')).toBe(false)
  })
})
