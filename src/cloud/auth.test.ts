import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeAuthCallbackError, signInWithPassword, updateCurrentUserPassword, verifySignInCode, verifySignInLink } from './auth'

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), signInWithPassword: vi.fn(), getUser: vi.fn(), updateUser: vi.fn() }))
vi.mock('./client', () => ({ getCloudClient: () => ({ auth }), clearCloudSession: vi.fn() }))
vi.mock('./config', () => ({ getCloudConfig: () => ({ url: 'https://example.supabase.co', publishableKey: 'public-test-key' }) }))

beforeEach(() => {
  vi.resetAllMocks()
  auth.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null })
  auth.signInWithPassword.mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null })
  auth.getUser.mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null })
  auth.updateUser.mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null })
})

describe('verification inside the active browser context', () => {
  it('uses email OTP verification, without navigating to Safari', async () => {
    const session = await verifySignInCode(' Traveller@Example.com ', '012 345')
    expect(session.user.id).toBe('test-user')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'traveller@example.com', token: '012345', type: 'email' })
  })

  it('verifies an original email link through the local Supabase client', async () => {
    const token = 'a'.repeat(64)
    await verifySignInLink(`https://example.supabase.co/auth/v1/verify?token=${token}&type=magiclink&redirect_to=https://other.example`)
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: token, type: 'magiclink' })
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
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('rejects malformed codes and unacknowledged sessions', async () => {
    await expect(verifySignInCode('a@example.com', 'invalid')).rejects.toThrow('digit code')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null })
    await expect(verifySignInCode('a@example.com', '123456')).rejects.toThrow('not completed')
    auth.verifyOtp.mockResolvedValueOnce({ data: {}, error: new Error('Token has expired') })
    await expect(verifySignInCode('a@example.com', '123456')).rejects.toThrow('expired')
  })

  describe('password authentication', () => {
    it('signs in the existing user without sign-up or anonymous APIs', async () => {
      const session = await signInWithPassword(' Traveller@Example.com ', 'secret-password')
      expect(session.user.id).toBe('test-user')
      expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'traveller@example.com', password: 'secret-password' })
      expect(auth).not.toHaveProperty('signUp')
      expect(auth).not.toHaveProperty('signInAnonymously')
    })

    it('updates the same authenticated user rather than creating another account', async () => {
      await updateCurrentUserPassword('new-secret')
      expect(auth.getUser).toHaveBeenCalledOnce()
      expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-secret' })
      auth.updateUser.mockResolvedValueOnce({ data: { user: { id: 'different-user' } }, error: null })
      await expect(updateCurrentUserPassword('new-secret')).rejects.toThrow('not acknowledged')
    })

    it('surfaces incorrect-password and weak-password server errors', async () => {
      auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: new Error('Invalid login credentials') })
      await expect(signInWithPassword('a@example.com', 'wrong')).rejects.toThrow('Invalid login')
      auth.updateUser.mockResolvedValueOnce({ data: {}, error: Object.assign(new Error('Password is too weak'), { code: 'weak_password' }) })
      await expect(updateCurrentUserPassword('123456')).rejects.toThrow('too weak')
    })
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
