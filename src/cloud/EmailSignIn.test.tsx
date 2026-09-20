import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailSignIn } from './EmailSignIn'

const auth = vi.hoisted(() => ({
  requestSignIn: vi.fn(), verifySignInCode: vi.fn(), verifySignInLink: vi.fn(), signInWithPassword: vi.fn(),
}))
vi.mock('./auth', () => auth)

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  auth.requestSignIn.mockResolvedValue(undefined)
  auth.verifySignInCode.mockResolvedValue({ user: { id: 'user' } })
  auth.verifySignInLink.mockResolvedValue({ user: { id: 'user' } })
  auth.signInWithPassword.mockResolvedValue({ user: { id: 'user' } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

async function requestEmail() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Traveller@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }))
  await screen.findByLabelText('Email code')
}

describe('in-app email login', () => {
  it('signs in with password inside the app and clears the password immediately', async () => {
    const onSignedIn = vi.fn()
    render(<EmailSignIn onSignedIn={onSignedIn}/>)
    expect(screen.getByRole('tab', { name: 'Password' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Traveller@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }))
    expect(screen.getByLabelText('Password')).toHaveValue('')
    await act(async () => {})
    expect(auth.signInWithPassword).toHaveBeenCalledWith('Traveller@example.com', 'secret-password')
    expect(onSignedIn).toHaveBeenCalledOnce()
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-password')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-password')
    expect(window.location.href).not.toContain('secret-password')
  })

  it('keeps email but never password when switching methods or after an error', async () => {
    auth.signInWithPassword.mockRejectedValueOnce(new Error('Invalid login credentials'))
    render(<EmailSignIn onSignedIn={vi.fn()}/>)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'traveller@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    expect(screen.getByLabelText('Email')).toHaveValue('traveller@example.com')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('verifies the email code in the current app, preserving leading zeroes', async () => {
    const onSignedIn = vi.fn()
    render(<EmailSignIn onSignedIn={onSignedIn}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    await requestEmail()
    expect(auth.requestSignIn).toHaveBeenCalledWith('traveller@example.com')
    expect(screen.getByLabelText('Email code')).toHaveAttribute('autocomplete', 'one-time-code')
    fireEvent.change(screen.getByLabelText('Email code'), { target: { value: '012345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in here' }))
    await act(async () => {})
    expect(auth.verifySignInCode).toHaveBeenCalledWith('traveller@example.com', '012345')
    expect(onSignedIn).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Email code')).toHaveValue('')
  })

  it('supports copying an unopened link without navigation or another email', async () => {
    const onSignedIn = vi.fn()
    render(<EmailSignIn onSignedIn={onSignedIn}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    await requestEmail()
    fireEvent.click(screen.getByRole('button', { name: 'My email only has a sign-in link' }))
    const link = 'https://example.supabase.co/auth/v1/verify?token=example&type=magiclink'
    fireEvent.change(screen.getByLabelText('Sign-in link'), { target: { value: link } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in here' }))
    await act(async () => {})
    expect(auth.verifySignInLink).toHaveBeenCalledWith(link)
    expect(auth.requestSignIn).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Sign-in link')).toHaveValue('')
    expect(onSignedIn).toHaveBeenCalledOnce()
  })

  it('keeps verification errors visible and allows a fresh credential', async () => {
    auth.verifySignInCode.mockRejectedValueOnce(new Error('Token has expired'))
    render(<EmailSignIn onSignedIn={vi.fn()}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    await requestEmail()
    fireEvent.change(screen.getByLabelText('Email code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in here' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Token has expired')
    expect(screen.getByLabelText('Email code')).toBeEnabled()
    expect(screen.getByLabelText('Email code')).toHaveValue('')
  })

  it('does not send a duplicate email during cooldown', async () => {
    vi.useFakeTimers()
    render(<EmailSignIn onSignedIn={vi.fn()}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'traveller@example.com' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' })) })
    expect(screen.getByRole('button', { name: 'Resend in 60s' })).toBeDisabled()
    act(() => vi.advanceTimersByTime(59_000))
    expect(screen.getByRole('button', { name: 'Resend in 1s' })).toBeDisabled()
    act(() => vi.advanceTimersByTime(1000))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resend email' })) })
    expect(auth.requestSignIn).toHaveBeenCalledTimes(2)
  })

  it('shows email rate limits without moving to the verification step', async () => {
    auth.requestSignIn.mockRejectedValueOnce(new Error('Email rate limit exceeded'))
    render(<EmailSignIn onSignedIn={vi.fn()}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'traveller@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email rate limit exceeded')
    expect(screen.queryByLabelText('Email code')).not.toBeInTheDocument()
  })

  it('can resume with an existing email after the PWA is reopened', async () => {
    render(<EmailSignIn onSignedIn={vi.fn()}/>)
    fireEvent.click(screen.getByRole('tab', { name: 'Email code / link' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'traveller@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'I already have a code or link' }))
    expect(screen.getByLabelText('Email code')).toBeInTheDocument()
    expect(auth.requestSignIn).not.toHaveBeenCalled()
  })
})
