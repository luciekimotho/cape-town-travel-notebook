import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import CloudApp from './CloudApp'

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(), claimSharedTrip: vi.fn(), listCloudTrips: vi.fn(),
  callback: undefined as undefined | ((event: string, session: Session | null) => void),
  inCallback: false,
  unsubscribe: vi.fn(),
}))
vi.mock('../App', () => ({
  NotebookApplication: () => <h1>Existing shared itinerary</h1>,
  TransientNotice: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}))
vi.mock('./auth', () => ({
  currentSession: mocks.currentSession, claimSharedTrip: mocks.claimSharedTrip,
  consumeAuthCallbackError: () => '', signOut: vi.fn(),
}))
vi.mock('./EmailSignIn', () => ({ EmailSignIn: () => <p>Sign in here</p> }))
vi.mock('./config', () => ({ cloudSetupIssue: () => undefined }))
vi.mock('./client', () => ({
  getCloudClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.callback) => {
    mocks.callback = callback
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
  } } }),
}))
vi.mock('./notebookStore', () => ({ CloudNotebookStore: class {} }))
vi.mock('./repository', () => ({
  listCloudTrips: mocks.listCloudTrips,
  createFreshTrip: vi.fn(),
  CloudNotebookRepository: class { collaborationStatus() { return Promise.resolve({ role: 'owner' }) } },
}))

const session = { user: { id: 'traveller', email: 'traveller@example.com' } } as Session

beforeEach(() => {
  vi.clearAllMocks()
  mocks.inCallback = false
  mocks.currentSession.mockResolvedValue(null)
  mocks.claimSharedTrip.mockImplementation(async () => {
    if (mocks.inCallback) throw new Error('RPC invoked inside auth callback')
  })
  mocks.listCloudTrips.mockResolvedValue([{ id: 'existing-trip', role: 'owner' }])
})
afterEach(cleanup)

describe('auth session completion', () => {
  it('loads the existing trip after in-app verification, outside the auth lock', async () => {
    render(<CloudApp/>)
    await screen.findByText('Sign in here')
    act(() => {
      mocks.inCallback = true
      mocks.callback?.('SIGNED_IN', session)
      expect(mocks.claimSharedTrip).not.toHaveBeenCalled()
      mocks.inCallback = false
    })
    await screen.findByRole('heading', { name: 'Existing shared itinerary' })
    expect(mocks.claimSharedTrip).toHaveBeenCalledOnce()
    act(() => mocks.callback?.('TOKEN_REFRESHED', { ...session, access_token: 'refreshed-test-token' }))
    expect(mocks.claimSharedTrip).toHaveBeenCalledOnce()
  })

  it('restores a stored session without asking for another email', async () => {
    mocks.currentSession.mockResolvedValue(session)
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'Existing shared itinerary' })
    expect(screen.queryByText('Sign in here')).not.toBeInTheDocument()
  })

  it('does not let a late initial session lookup overwrite completed verification', async () => {
    let resolve!: (session: Session | null) => void
    mocks.currentSession.mockReturnValue(new Promise<Session | null>(done => { resolve = done }))
    render(<CloudApp/>)
    act(() => mocks.callback?.('SIGNED_IN', session))
    await screen.findByRole('heading', { name: 'Existing shared itinerary' })
    await act(async () => resolve(null))
    expect(screen.queryByText('Sign in here')).not.toBeInTheDocument()
  })

  it('does not offer to create a new trip when existing-trip loading fails', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.listCloudTrips.mockRejectedValueOnce(new Error('Network unavailable'))
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'Could not load your trip' })
    expect(screen.queryByRole('button', { name: 'Create Cape Town 2026' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable')
    act(() => screen.getByRole('button', { name: 'Retry' }).click())
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Existing shared itinerary' })).toBeInTheDocument())
  })
})
