import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeAuthCallbackError, verifySignInCode, verifySignInLink } from './auth'

const verifyOtp = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ getCloudClient: () => ({ auth: { verifyOtp } }), clearCloudSession: vi.fn() }))
vi.mock('./config', () => ({ getCloudConfig: () => ({ url: 'https://example.supabase.co', publishableKey: 'public-test-key' }) }))

beforeEach(() => {
  verifyOtp.mockReset()
  verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null })
})

describe('verification inside the active browser context', () => {
  it('uses email OTP verification, without navigating to Safari', async () => {
    const session = await verifySignInCode(' Traveller@Example.com ', '012 345')
    expect(session.user.id).toBe('test-user')
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'traveller@example.com', token: '012345', type: 'email' })
  })

  it('verifies an original email link through the local Supabase client', async () => {
    const token = 'a'.repeat(64)
    await verifySignInLink(`https://example.supabase.co/auth/v1/verify?token=${token}&type=magiclink&redirect_to=https://other.example`)
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: token, type: 'magiclink' })
    expect(window.location.hostname).not.toBe('other.example')
  })

  it.each([
    'not a link',
    `https://attacker.example/auth/v1/verify?token=${'a'.repeat(64)}&type=magiclink`,
    `https://example.supabase.co/auth/v1/verify?token=${'a'.repeat(64)}&type=recovery`,
    `https://example.supabase.co/auth/v1/verify?token=${'a'.repeat(64)}&type=invite`,
    `https://example.supabase.co/auth/v1/verify?token=${'a'.repeat(64)}&type=magiclink#access_token=secret`,
    `https://user:password@example.supabase.co/auth/v1/verify?token=${'a'.repeat(64)}&type=magiclink`,
    'https://notebook.example/#access_token=secret&refresh_token=secret',
  ])('rejects unsupported or foreign links before any request', async link => {
    await expect(verifySignInLink(link)).rejects.toThrow()
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('rejects malformed codes and unacknowledged sessions', async () => {
    await expect(verifySignInCode('a@example.com', 'invalid')).rejects.toThrow('digit code')
    expect(verifyOtp).not.toHaveBeenCalled()
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null })
    await expect(verifySignInCode('a@example.com', '123456')).rejects.toThrow('not completed')
    verifyOtp.mockResolvedValueOnce({ data: {}, error: new Error('Token has expired') })
    await expect(verifySignInCode('a@example.com', '123456')).rejects.toThrow('expired')
  })
})

describe('auth callback errors', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('surfaces and clears an expired magic-link error', () => {
    window.history.replaceState(null, '', '/cape-town-travel-notebook/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')

    expect(consumeAuthCallbackError()).toBe('Email link is invalid or has expired')
    expect(window.location.hash).toBe('')
  })
})
