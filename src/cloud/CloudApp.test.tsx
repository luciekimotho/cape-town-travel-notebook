import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import CloudApp from './CloudApp'
import { CLOUD_WAIT_MS } from './connection'

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(), claimSharedTrip: vi.fn(), listCloudTrips: vi.fn(), getUser: vi.fn(),
  getActive: vi.fn(), get: vi.fn(), rememberAccount: vi.fn(), invalidateOtherUsers: vi.fn(),
  invalidateUser: vi.fn(), clearAll: vi.fn(), remove: vi.fn(), download: vi.fn(), signOut: vi.fn(), load: vi.fn(),
  callback: undefined as undefined | ((event: string, session: Session | null) => void),
  inCallback: false, editorOpen: false, settingsOpen: false, unsubscribe: vi.fn(), application: vi.fn(),
  cacheListener: undefined as undefined | (() => void), initialCacheNotification: false, unsubscribeCache: vi.fn(),
}))
vi.mock('../App', () => ({
  NotebookApplication: (props: { store: { kind: string }; readOnly?: boolean; downloads: {
    onUseDownload?: () => void; onReturnLive?: () => void; onDownload?: () => void
    onRemove: () => Promise<void>; onSignOut: () => Promise<void>; error?: string; savedAt?: string
  } }) => {
    mocks.application(props)
    return <><h1>{props.store.kind === 'download' ? 'Downloaded itinerary' : 'Existing shared itinerary'}</h1>
      {mocks.editorOpen && <section role="dialog" aria-label="Edit activity"><form><input defaultValue="Draft"/></form></section>}
      {mocks.settingsOpen && <section role="dialog" aria-labelledby="test-settings-title"><h2 id="test-settings-title">Settings</h2><form><input aria-label="Rate" defaultValue="130"/></form></section>}
      <span>{props.readOnly ? 'Read only' : 'Editing enabled'}</span>
      <span>{props.downloads.savedAt}</span>
      {props.downloads.error && <p role="alert">{props.downloads.error}</p>}
      {props.downloads.onUseDownload && <button onClick={props.downloads.onUseDownload}>Use download</button>}
      {props.downloads.onReturnLive && <button onClick={props.downloads.onReturnLive}>Return live</button>}
      {props.downloads.onDownload && <button onClick={props.downloads.onDownload}>Download</button>}
      <button onClick={() => void props.downloads.onRemove().catch(() => {})}>Remove</button>
      <button onClick={() => void props.downloads.onSignOut().catch(() => {})}>Sign out</button>
    </>
  },
}))
vi.mock('./auth', () => ({
  currentSession: mocks.currentSession, claimSharedTrip: mocks.claimSharedTrip,
  consumeAuthCallbackError: () => '', signOut: mocks.signOut,
}))
vi.mock('./EmailSignIn', () => ({ EmailSignIn: () => <p>Sign in here</p> }))
vi.mock('./config', () => ({ cloudSetupIssue: () => undefined }))
vi.mock('./client', () => ({
  getCloudClient: () => ({ auth: {
    getUser: mocks.getUser,
    onAuthStateChange: (callback: typeof mocks.callback) => {
      mocks.callback = callback
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
    },
  } }),
}))
vi.mock('./notebookStore', () => ({ CloudNotebookStore: class {
  kind = 'cloud'; readOnly = false; load = mocks.load
} }))
vi.mock('../offline/store', () => ({ DownloadedNotebookStore: class { kind = 'download'; readOnly = true } }))
vi.mock('../offline/downloads', () => ({
  offlineDownloads: {
    getActive: mocks.getActive, get: mocks.get, rememberAccount: mocks.rememberAccount,
    invalidateOtherUsers: mocks.invalidateOtherUsers, invalidateUser: mocks.invalidateUser,
    clearAll: mocks.clearAll, remove: mocks.remove, download: mocks.download,
    subscribe: (listener: () => void) => {
      mocks.cacheListener = listener
      if (mocks.initialCacheNotification) queueMicrotask(listener)
      return mocks.unsubscribeCache
    },
  },
  isAuthorizationError: (error: { status?: number }) => error.status === 401 || error.status === 403,
  isMembershipRevokedError: (error: { status?: number; message?: string }) =>
    error.status === 403 || error.message === 'Trip membership with edit access is required',
}))
vi.mock('./repository', () => ({
  listCloudTrips: mocks.listCloudTrips, createFreshTrip: vi.fn(),
  CloudNotebookRepository: class { collaborationStatus() { return Promise.resolve({ role: 'owner' }) } },
}))

const session = { user: { id: 'traveller', email: 'traveller@example.com' }, expires_at: 1 } as Session
const snapshot = { userId: 'traveller', tripId: 'existing-trip', savedAt: '2026-09-18T09:00:00Z', notebook: {} }
const pending = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const connection = (online: boolean) => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online)
  act(() => window.dispatchEvent(new Event(online ? 'online' : 'offline')))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mocks.inCallback = false
  mocks.editorOpen = false
  mocks.settingsOpen = false
  mocks.cacheListener = undefined
  mocks.initialCacheNotification = false
  mocks.currentSession.mockResolvedValue(null)
  mocks.getUser.mockResolvedValue({ data: { user: session.user }, error: null })
  mocks.claimSharedTrip.mockImplementation(async () => {
    if (mocks.inCallback) throw new Error('RPC invoked inside auth callback')
  })
  mocks.listCloudTrips.mockResolvedValue([{ id: 'existing-trip', role: 'owner' }])
  mocks.getActive.mockResolvedValue(undefined)
  mocks.load.mockResolvedValue({})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('auth session completion', () => {
  it('loads the existing trip after verification outside the auth lock, not on token refresh', async () => {
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
    act(() => mocks.callback?.('TOKEN_REFRESHED', { ...session, access_token: 'disposable-test-token' }))
    expect(mocks.claimSharedTrip).toHaveBeenCalledOnce()
  })

  it('restores a stored session after server verification', async () => {
    mocks.currentSession.mockResolvedValue(session)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    expect(mocks.getUser).toHaveBeenCalledOnce()
    expect(mocks.rememberAccount).toHaveBeenCalledWith('traveller', 'existing-trip')
  })

  it('does not let a late initial lookup overwrite completed verification', async () => {
    const lookup = pending<Session | null>()
    mocks.currentSession.mockReturnValue(lookup.promise)
    render(<CloudApp/>)
    act(() => mocks.callback?.('SIGNED_IN', session))
    await screen.findByRole('heading', { name: 'Existing shared itinerary' })
    await act(async () => lookup.resolve(null))
    expect(screen.queryByText('Sign in here')).not.toBeInTheDocument()
  })

  it('never offers create while loading or after a non-network load error', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.listCloudTrips.mockRejectedValueOnce(new Error('Server returned invalid trip data'))
    render(<CloudApp/>)
    expect(screen.queryByText('Create Cape Town 2026')).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Could not load your trip' })
    expect(screen.queryByText('Create Cape Town 2026')).not.toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Retry' }).click())
    await screen.findByRole('heading', { name: 'Existing shared itinerary' })
  })
})

describe('trusted offline downloads', () => {
  it('opens the trusted offline snapshot when subscription emits its initial baseline during startup', async () => {
    connection(false)
    mocks.initialCacheNotification = true
    mocks.currentSession.mockReturnValue(new Promise(() => {}))
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'Downloaded itinerary' })
    expect(screen.getByText(snapshot.savedAt)).toBeInTheDocument()
  })

  it('does not publish an initial cache read if subscription finds it was removed during startup', async () => {
    connection(false)
    mocks.initialCacheNotification = true
    const initial = pending<typeof snapshot>()
    mocks.getActive.mockReturnValueOnce(initial.promise).mockResolvedValue(undefined)
    render(<CloudApp/>)
    await act(async () => { initial.resolve(snapshot) })
    await screen.findByText('No downloaded trip on this device')
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
  })

  it('opens cached data while auth is still pending offline', async () => {
    connection(false)
    mocks.currentSession.mockReturnValue(new Promise(() => {}))
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'Downloaded itinerary' })
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('shows a finite no-copy screen offline without signing in or creating', async () => {
    connection(false)
    mocks.currentSession.mockReturnValue(new Promise(() => {}))
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'No downloaded trip on this device' })
    expect(screen.queryByText('Sign in here')).not.toBeInTheDocument()
    expect(screen.queryByText('Create Cape Town 2026')).not.toBeInTheDocument()
  })

  it('allows an expired stored token offline and preserves trust on transient SIGNED_OUT', async () => {
    connection(false)
    mocks.currentSession.mockResolvedValue(session)
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'Downloaded itinerary' })
    act(() => mocks.callback?.('SIGNED_OUT', null))
    expect(screen.getByRole('heading', { name: 'Downloaded itinerary' })).toBeInTheDocument()
    expect(mocks.clearAll).not.toHaveBeenCalled()
    expect(mocks.invalidateUser).not.toHaveBeenCalled()
  })

  it('offers a cache for transport failure even when navigator says online', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.getUser.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<CloudApp/>)
    await screen.findByRole('heading', { name: 'Downloaded itinerary' })
    expect(mocks.invalidateUser).not.toHaveBeenCalled()
  })

  it('bounds a stalled authentication handshake and opens the cache', async () => {
    vi.useFakeTimers()
    mocks.currentSession.mockReturnValue(new Promise(() => {}))
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await act(async () => { await vi.advanceTimersByTimeAsync(CLOUD_WAIT_MS + 1) })
    expect(screen.getByRole('heading', { name: 'Downloaded itinerary' })).toBeInTheDocument()
  })

  it('does not use cached data as success after an online authentication rejection', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, message: 'Session expired' } })
    render(<CloudApp/>)
    await screen.findByText('Sign in here')
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
    expect(mocks.invalidateUser).not.toHaveBeenCalled()
  })

  it('invalidates a confirmed revoked membership instead of offering create or a stale copy', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.listCloudTrips.mockResolvedValue([])
    render(<CloudApp/>)
    await screen.findByText('Sign in here')
    expect(mocks.invalidateUser).toHaveBeenCalledWith('traveller')
    expect(screen.queryByText('Create Cape Town 2026')).not.toBeInTheDocument()
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
  })

  it('purges the previous account even if the newly verified account has no trips', async () => {
    const other = { user: { id: 'another', email: 'other@example.com' } } as Session
    mocks.currentSession.mockResolvedValue(other)
    mocks.getUser.mockResolvedValue({ data: { user: other.user }, error: null })
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.listCloudTrips.mockResolvedValue([])
    render(<CloudApp/>)
    await screen.findByText('Create Cape Town 2026')
    expect(mocks.invalidateOtherUsers).toHaveBeenCalledWith('another')
    expect(mocks.invalidateOtherUsers.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.getUser.mock.invocationCallOrder[0])
    expect(mocks.invalidateOtherUsers.mock.invocationCallOrder[0]).toBeLessThan(mocks.listCloudTrips.mock.invocationCallOrder[0])
    connection(false)
    await screen.findByRole('heading', { name: 'No downloaded trip on this device' })
  })

  it('reports cache storage failures visibly', async () => {
    connection(false)
    mocks.getActive.mockRejectedValue(new Error('IndexedDB blocked'))
    render(<CloudApp/>)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('IndexedDB blocked')
  })

  it('retains the live store when connection drops, verifies reconnect, and explicitly returns from download', async () => {
    mocks.editorOpen = true
    mocks.currentSession.mockResolvedValue(session)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.get.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    const initialStore = mocks.application.mock.lastCall?.[0].store
    connection(false)
    expect(screen.getByText('Existing shared itinerary')).toBeInTheDocument()
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(mocks.application.mock.lastCall?.[0].store).toBe(initialStore)
    act(() => screen.getByText('Use download').click())
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(screen.getByText('Downloaded itinerary')).toBeInTheDocument()
    connection(true)
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Downloaded itinerary')).toBeInTheDocument()
    act(() => screen.getByText('Return live').click())
    await screen.findByText('Editing enabled')
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })

  it('does not switch views when discarding drafts is declined', async () => {
    mocks.editorOpen = true
    mocks.currentSession.mockResolvedValue(session)
    mocks.get.mockResolvedValue(snapshot)
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    act(() => screen.getByText('Use download').click())
    expect(screen.getByText('Existing shared itinerary')).toBeInTheDocument()
  })

  it('does not ask to discard drafts just because Settings is open', async () => {
    mocks.settingsOpen = true
    mocks.currentSession.mockResolvedValue(session)
    mocks.get.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    act(() => screen.getByText('Use download').click())
    expect(window.confirm).not.toHaveBeenCalled()
    expect(screen.getByText('Downloaded itinerary')).toBeInTheDocument()
  })

  it('protects changed Settings fields before opening the download', async () => {
    mocks.settingsOpen = true
    mocks.currentSession.mockResolvedValue(session)
    mocks.get.mockResolvedValue(snapshot)
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    const field = screen.getByRole('textbox', { name: 'Rate' }) as HTMLInputElement
    field.value = '140'
    act(() => screen.getByText('Use download').click())
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(screen.getByText('Existing shared itinerary')).toBeInTheDocument()
    expect(field.value).toBe('140')
  })

  it('does not resurrect an in-flight download after explicit logout', async () => {
    const completion = pending<typeof snapshot>()
    mocks.currentSession.mockResolvedValue(session)
    mocks.download.mockReturnValue(completion.promise)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    act(() => screen.getByText('Download').click())
    act(() => screen.getByText('Sign out').click())
    await screen.findByText('Sign in here')
    await act(async () => completion.resolve(snapshot))
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })

  it('ignores late startup cache and session reads after logout', async () => {
    connection(false)
    const cache = pending<typeof snapshot>()
    const auth = pending<Session | null>()
    mocks.getActive.mockReturnValue(cache.promise)
    mocks.currentSession.mockReturnValue(auth.promise)
    render(<CloudApp/>)
    act(() => screen.getByText('Sign out and clear this device').click())
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce())
    await act(async () => { cache.resolve(snapshot); auth.resolve(session) })
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
    connection(true)
    await screen.findByText('Sign in here')
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('keeps live edits blocked until reconnect verification completes', async () => {
    mocks.currentSession.mockResolvedValue(session)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    connection(false)
    const verification = pending<{ data: { user: typeof session.user }; error: null }>()
    mocks.getUser.mockReturnValue(verification.promise)
    connection(true)
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(mocks.application.mock.lastCall?.[0].store.readOnly).toBe(true)
    await act(async () => verification.resolve({ data: { user: session.user }, error: null }))
    await screen.findByText('Editing enabled')
    expect(mocks.load).toHaveBeenCalledOnce()
  })

  it('retains the previous saved timestamp when refreshing the download fails', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.get.mockResolvedValue(snapshot)
    mocks.download.mockRejectedValue(new Error('Photo download failed'))
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    act(() => screen.getByText('Download').click())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Photo download failed'))
    expect(screen.getByText(snapshot.savedAt)).toBeInTheDocument()
  })

  it('shows logout storage failures and never claims successful signout', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.signOut.mockRejectedValue(new Error('Storage wipe denied'))
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    act(() => screen.getByText('Sign out').click())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sign out could not be completed'))
    expect(screen.getByText('Downloaded itinerary')).toBeInTheDocument()
  })

  it('removes the displayed snapshot after the wipe even if SDK signout fails offline', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.signOut.mockImplementation(async (onDeviceCleared: () => void) => {
      onDeviceCleared()
      throw new Error('SDK signout network unavailable')
    })
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    act(() => screen.getByText('Sign out').click())
    await screen.findByText('No downloaded trip on this device')
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Sign out could not be completed')
    expect(screen.getByRole('alert')).toHaveTextContent('SDK signout network unavailable')
  })

  it('removing the open downloaded snapshot shows the no-copy screen only after acknowledgement', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    act(() => screen.getByText('Remove').click())
    await screen.findByText('No downloaded trip on this device')
    expect(mocks.remove).toHaveBeenCalledWith('traveller', 'existing-trip')
  })

  it('keeps the downloaded snapshot visible if removal fails', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.remove.mockRejectedValue(new Error('Storage removal denied'))
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    act(() => screen.getByText('Remove').click())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Storage removal denied'))
    expect(screen.getByText('Downloaded itinerary')).toBeInTheDocument()
  })

  it.each(['removed', 'different-account'])('dismisses a rendered download after cross-tab %s notification', async change => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    mocks.getActive.mockResolvedValue(change === 'removed' ? undefined : { ...snapshot, userId: 'another-account' })
    act(() => mocks.cacheListener?.())
    await screen.findByText('No downloaded trip on this device')
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
  })

  it('accepts same-identity refreshed downloads after a storage notification', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    const updated = { ...snapshot, savedAt: '2026-09-19T09:00:00Z' }
    mocks.getActive.mockResolvedValue(updated)
    act(() => mocks.cacheListener?.())
    await screen.findByText(updated.savedAt)
    expect(screen.getByText('Downloaded itinerary')).toBeInTheDocument()
  })

  it('does not replace the live store or initial data when another tab refreshes the cache', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.getActive.mockResolvedValue(snapshot)
    mocks.get.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    const original = mocks.application.mock.lastCall?.[0]
    const updated = { ...snapshot, savedAt: '2026-09-19T09:00:00Z', notebook: { refreshed: true } }
    mocks.getActive.mockResolvedValue(updated)
    act(() => mocks.cacheListener?.())
    await screen.findByText(updated.savedAt)
    expect(mocks.application.mock.lastCall?.[0].store).toBe(original.store)
    expect(mocks.application.mock.lastCall?.[0].initialData).toBe(original.initialData)
  })

  it('publishes a newly completed download through its own durable storage notification', async () => {
    mocks.currentSession.mockResolvedValue(session)
    mocks.download.mockImplementation(async () => {
      mocks.getActive.mockResolvedValue(snapshot)
      mocks.cacheListener?.()
      return snapshot
    })
    render(<CloudApp/>)
    await screen.findByText('Editing enabled')
    act(() => screen.getByText('Download').click())
    await screen.findByText(snapshot.savedAt)
    expect(screen.getByText('Use download')).toBeInTheDocument()
  })

  it('does not adopt an unfamiliar account from a notification on the offline no-copy screen', async () => {
    connection(false)
    render(<CloudApp/>)
    await screen.findByText('No downloaded trip on this device')
    mocks.getActive.mockResolvedValue({ ...snapshot, userId: 'another-account' })
    await act(async () => mocks.cacheListener?.())
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
    expect(screen.getByText('No downloaded trip on this device')).toBeInTheDocument()
  })

  it('hides stale downloaded memory and reports notification read failures', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    mocks.getActive.mockRejectedValue(new Error('Storage no longer accessible'))
    act(() => mocks.cacheListener?.())
    await screen.findByText('No downloaded trip on this device')
    expect(screen.getByRole('alert')).toHaveTextContent('Storage no longer accessible')
  })

  it('ignores a notification read that finishes after logout', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    const read = pending<typeof snapshot>()
    mocks.getActive.mockReturnValue(read.promise)
    act(() => mocks.cacheListener?.())
    act(() => screen.getByText('Sign out').click())
    await screen.findByText('No downloaded trip on this device')
    await act(async () => read.resolve(snapshot))
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
  })

  it('ignores older notification reads after a newer cross-tab removal', async () => {
    connection(false)
    mocks.getActive.mockResolvedValue(snapshot)
    const view = render(<CloudApp/>)
    await screen.findByText('Downloaded itinerary')
    const older = pending<typeof snapshot>()
    mocks.getActive.mockReturnValueOnce(older.promise).mockResolvedValue(undefined)
    act(() => mocks.cacheListener?.())
    act(() => mocks.cacheListener?.())
    await screen.findByText('No downloaded trip on this device')
    await act(async () => older.resolve(snapshot))
    expect(screen.queryByText('Downloaded itinerary')).not.toBeInTheDocument()
    view.unmount()
    expect(mocks.unsubscribeCache).toHaveBeenCalledOnce()
  })
})
