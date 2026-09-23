import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudAccountSettings, type CloudAccountControls } from './App'

afterEach(cleanup)

function account(setPassword = vi.fn().mockResolvedValue(undefined)): CloudAccountControls {
  return {
    email: 'traveller@example.com', role: 'editor',
    pendingEmail: null, claimedEmail: null, claimedUserId: null,
    share: vi.fn(), revokePending: vi.fn(), removeEditor: vi.fn(),
    setPassword, signOut: vi.fn(),
  }
}
const commit = vi.fn(async (operation: () => Promise<unknown>) => { await operation(); return true })

describe('current-account password setup', () => {
  it('updates the existing account and clears both sensitive inputs immediately', async () => {
    let resolve!: () => void
    const setPassword = vi.fn(() => new Promise<void>(done => { resolve = done }))
    render(<CloudAccountSettings account={account(setPassword)} commit={commit} busy={false}/>)
    fireEvent.click(screen.getByText('Set or change password'))
    const password = screen.getByLabelText('New password')
    const confirmation = screen.getByLabelText('Confirm password')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    fireEvent.change(password, { target: { value: 'strong-password' } })
    fireEvent.change(confirmation, { target: { value: 'strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(password).toHaveValue('')
    expect(confirmation).toHaveValue('')
    expect(setPassword).toHaveBeenCalledWith('strong-password')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await act(async () => resolve())
    expect(await screen.findByRole('status')).toHaveTextContent('Password saved')
  })

  it('rejects mismatch and short passwords without calling Supabase', () => {
    const controls = account()
    render(<CloudAccountSettings account={controls} commit={commit} busy={false}/>)
    fireEvent.click(screen.getByText('Set or change password'))
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('do not match')
    expect(controls.setPassword).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: '12345' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '12345' } })
    fireEvent.submit(screen.getByLabelText('New password').closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('at least 6')
    expect(screen.getByLabelText('New password')).toHaveValue('')
  })

  it('shows the server password policy error and leaves no password in the DOM', async () => {
    const setPassword = vi.fn().mockRejectedValue(Object.assign(new Error('Password is too weak'), { code: 'weak_password' }))
    render(<CloudAccountSettings account={account(setPassword)} commit={commit} busy={false}/>)
    fireEvent.click(screen.getByText('Set or change password'))
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('stronger password')
    expect(screen.getByLabelText('New password')).toHaveValue('')
    expect(screen.getByLabelText('Confirm password')).toHaveValue('')
  })
})
