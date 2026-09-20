import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { NotebookApplication, type CloudAccountControls, type DownloadControls } from '../App'
import type { AppData } from '../types'
import { offlineDownloads, isAuthorizationError, isMembershipRevokedError as membershipDenied, type DownloadedTrip } from '../offline/downloads'
import { DownloadedNotebookStore } from '../offline/store'
import { claimSharedTrip, consumeAuthCallbackError, currentSession, signOut } from './auth'
import { EmailSignIn } from './EmailSignIn'
import { getCloudClient } from './client'
import { cloudSetupIssue } from './config'
import { bounded, isConnectionError } from './connection'
import { CloudNotebookStore } from './notebookStore'
import { CloudNotebookRepository, createFreshTrip, listCloudTrips, type CloudTripSummary, type CollaborationStatus } from './repository'

type Status = 'checking' | 'ready' | 'network' | 'error' | 'auth'
type LiveNotebook = { userId: string; trip: CloudTripSummary; store: CloudNotebookStore; notebook: AppData }
const message = (error: unknown) => error instanceof Error ? error.message :
  typeof error === 'object' && error && 'message' in error ? String(error.message) : 'The request failed. Please retry.'

function hasOpenEditor(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(dialog => {
    if (!dialog.querySelector('form')) return false
    const label = dialog.getAttribute('aria-labelledby')
    if (!label || document.getElementById(label)?.textContent?.trim() !== 'Settings') return true
    // Merely opening Settings is not an edit, but preserve unsaved rate/sharing fields.
    return [...dialog.querySelectorAll('input, textarea, select')].some(field => {
      if (field instanceof HTMLInputElement) {
        return field.type === 'checkbox' || field.type === 'radio'
          ? field.checked !== field.defaultChecked
          : field.type === 'file' ? Boolean(field.files?.length) : field.value !== field.defaultValue
      }
      if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue
      return field instanceof HTMLSelectElement && [...field.options].some(option => option.selected !== option.defaultSelected)
    })
  })
}

// PostgREST supports cancellation; auth requests are bounded without holding up cached startup.
function cancellableClient(client: SupabaseClient, signal: AbortSignal): SupabaseClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'rpc') return (...args: Parameters<SupabaseClient['rpc']>) => target.rpc(...args).abortSignal(signal)
      return Reflect.get(target, property, target)
    },
  })
}

export default function CloudApp() {
  const setupIssue = cloudSetupIssue()
  const [session, setSession] = useState<Session | null>()
  const [status, setStatus] = useState<Status>('checking')
  const [live, setLive] = useState<LiveNotebook>()
  const [cached, setCached] = useState<DownloadedTrip>()
  const [cacheLoaded, setCacheLoaded] = useState(false)
  const [cacheError, setCacheError] = useState('')
  const [mode, setMode] = useState<'live' | 'download'>('live')
  const [collaboration, setCollaboration] = useState<CollaborationStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(consumeAuthCallbackError)
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState('')
  const [retry, setRetry] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const generation = useRef(0)
  const authVersion = useRef(0)
  const cacheEpoch = useRef(0)
  const explicitlySigningOut = useRef(false)
  const returnRequested = useRef(false)
  const liveRef = useRef(live)
  liveRef.current = live
  const cachedRef = useRef(cached)
  cachedRef.current = cached
  const statusRef = useRef(status)
  statusRef.current = status
  const cacheLoadedRef = useRef(cacheLoaded)
  cacheLoadedRef.current = cacheLoaded
  const startupCache = useRef<Promise<DownloadedTrip | undefined> | undefined>(undefined)
  const sessionLookup = useRef<Promise<Session | null> | undefined>(undefined)
  const downloadStore = useMemo(() => cached ? new DownloadedNotebookStore(cached) : undefined, [cached])

  useEffect(() => {
    if (setupIssue) return
    let active = true
    let latestRead = 0
    const unsubscribe = offlineDownloads.subscribe(() => {
      const read = ++latestRead
      const epoch = ++cacheEpoch.current
      if (explicitlySigningOut.current) return
      const trusted = cachedRef.current ?? (liveRef.current ? {
        userId: liveRef.current.userId, tripId: liveRef.current.trip.id,
      } : !cacheLoadedRef.current ? startupCache.current : undefined)
      const current = () => active && read === latestRead && epoch === cacheEpoch.current && !explicitlySigningOut.current
      void bounded(Promise.all([trusted, offlineDownloads.getActive()])).then(([identity, snapshot]) => {
        if (!current()) return
        // A storage notification cannot authorize a different account or trip.
        const sameIdentity = identity && snapshot?.userId === identity.userId && snapshot.tripId === identity.tripId
        cachedRef.current = sameIdentity ? snapshot : undefined
        setCached(cachedRef.current)
        if (!navigator.onLine && !liveRef.current) setMode('download')
        setCacheLoaded(true)
      }).catch(error => {
        if (!current()) return
        cachedRef.current = undefined
        setCached(undefined)
        setCacheLoaded(true)
        setCacheError(`Downloaded trip storage: ${message(error)}`)
      })
    })
    return () => { active = false; latestRead++; unsubscribe() }
  }, [setupIssue])

  useEffect(() => {
    if (setupIssue) return
    let active = true
    const client = getCloudClient()
    const initialVersion = authVersion.current
    const initialCacheEpoch = cacheEpoch.current
    startupCache.current = bounded(offlineDownloads.getActive())
    void startupCache.current.then(snapshot => {
      if (!active || explicitlySigningOut.current || initialCacheEpoch !== cacheEpoch.current) return
      cachedRef.current = snapshot
      setCached(snapshot)
      if (!navigator.onLine) setMode('download')
    }).catch(error => { if (active) setCacheError(`Downloaded trip storage: ${message(error)}`) })
      .finally(() => { if (active) setCacheLoaded(true) })
    const lookup = currentSession()
    sessionLookup.current = lookup
    void bounded(lookup).then(next => {
      if (active && authVersion.current === initialVersion) setSession(next)
    }).catch(error => {
      if (!active || authVersion.current !== initialVersion) return
      setError(message(error))
      setStatus(isConnectionError(error) ? 'network' : 'auth')
      if (isConnectionError(error)) setMode('download')
      else setSession(null)
    }).finally(() => { if (sessionLookup.current === lookup) sessionLookup.current = undefined })
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!active || explicitlySigningOut.current) return
      // Do not await SDK calls here: auth notifications hold the SDK session lock.
      authVersion.current++
      if (event === 'SIGNED_OUT' && !navigator.onLine) {
        setStatus('network')
        return
      }
      if (next?.user.id !== liveRef.current?.userId && liveRef.current) {
        liveRef.current.store.readOnly = true
        setLive(undefined)
        setStatus('checking')
      }
      setSession(next)
      if (event === 'SIGNED_OUT') setRetry(value => value + 1)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [setupIssue])

  useEffect(() => {
    const update = () => {
      if (liveRef.current) liveRef.current.store.readOnly = true
      setOnline(navigator.onLine)
      setStatus(navigator.onLine ? 'checking' : 'network')
      if (!navigator.onLine && !liveRef.current) setMode('download')
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (setupIssue || !online || explicitlySigningOut.current) return
    const version = ++generation.current
    const controller = new AbortController()
    let active = true
    const current = () => active && version === generation.current && !explicitlySigningOut.current
    const client = cancellableClient(getCloudClient(), controller.signal)
    if (liveRef.current) liveRef.current.store.readOnly = true
    setStatus('checking')
    setDownloading(false); setProgress('')
    void (async () => {
      try {
        if (session === undefined) {
          const initialVersion = authVersion.current
          const restored = await bounded(sessionLookup.current ?? currentSession(), controller)
          if (current() && initialVersion === authVersion.current) setSession(restored)
          return
        }
        if (!session) {
          if (current()) { setStatus('auth'); setLive(undefined) }
          return
        }
        const result = await bounded(client.auth.getUser(), controller)
        if (!current()) return
        if (result.error) {
          if (isConnectionError(result.error)) throw result.error
          throw Object.assign(new Error(message(result.error)), { status: result.error.status === 403 ? 403 : 401 })
        }
        if (!result.data.user) throw Object.assign(new Error('Please sign in again to verify your account.'), { status: 401 })
        const verifiedId = result.data.user.id
        if (cachedRef.current && cachedRef.current.userId !== verifiedId) {
          cacheEpoch.current++; cachedRef.current = undefined; setCached(undefined)
          setDownloadError('')
        }
        if (liveRef.current && liveRef.current.userId !== verifiedId) setLive(undefined)
        const previous = await bounded(offlineDownloads.getActive())
        if (!current()) return
        if (previous?.userId !== verifiedId) {
          cacheEpoch.current++
          cachedRef.current = undefined; setCached(undefined)
        }
        // Purge a different remembered account even when it has no active snapshot.
        await offlineDownloads.invalidateOtherUsers(verifiedId)
        if (!current()) return
        if (previous && previous.userId !== verifiedId) { setCached(undefined); setLive(undefined) }
        if (verifiedId !== session.user.id) {
          setCached(undefined); setLive(undefined)
          throw Object.assign(new Error('Your account changed. Please sign in again.'), { status: 401 })
        }
        await bounded(claimSharedTrip(client), controller)
        const trips = await bounded(listCloudTrips(client), controller)
        if (!current()) return
        const expectedTrip = liveRef.current?.userId === verifiedId ? liveRef.current.trip.id :
          previous?.userId === verifiedId ? previous.tripId : undefined
        if (expectedTrip && !trips.some(trip => trip.id === expectedTrip)) {
          throw Object.assign(new Error('This account no longer has access to the downloaded trip. Please sign in again.'), { status: 403 })
        }
        const trip = trips.find(trip => trip.id === expectedTrip) ?? trips[0]
        if (!trip) {
          if (current()) { setLive(undefined); setCached(undefined); setMode('live'); setStatus('ready'); setError('') }
          return
        }
        await offlineDownloads.rememberAccount(verifiedId, trip.id)
        if (!current()) return
        const snapshotEpoch = cacheEpoch.current
        const snapshot = await offlineDownloads.get(verifiedId, trip.id)
        if (!current()) return
        if (snapshotEpoch === cacheEpoch.current) setCached(snapshot)
        const existing = liveRef.current
        if (!existing || existing.userId !== verifiedId || existing.trip.id !== trip.id || returnRequested.current) {
          const store = new CloudNotebookStore(trip.id)
          const notebook = await bounded(store.load(client), controller)
          if (!current()) return
          setLive({ userId: verifiedId, trip, store, notebook })
        } else {
          existing.store.readOnly = false
        }
        if (returnRequested.current) { setMode('live'); returnRequested.current = false }
        setStatus('ready'); setError('')
        void bounded(new CloudNotebookRepository(trip.id, client).collaborationStatus(), controller)
          .then(result => { if (current()) setCollaboration(result) })
          .catch(error => { if (current()) setError(message(error)) })
      } catch (error) {
        if (!current()) return
        setError(message(error))
        if (isAuthorizationError(error) || membershipDenied(error)) {
          setLive(undefined); setCached(undefined); setStatus('auth')
          // Authentication expiry is not a revocation. Only confirmed access denial purges.
          if (membershipDenied(error)) {
            cacheEpoch.current++
            try { await offlineDownloads.invalidateUser(userId!) } catch (storageError) { setCacheError(message(storageError)) }
          }
        } else if (isConnectionError(error)) {
          setStatus('network')
          if (!liveRef.current) setMode('download')
        } else setStatus('error')
      }
    })()
    return () => { active = false; controller.abort() }
    // Token refresh must not reload the notebook or discard an open editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session === null, online, retry, setupIssue])

  const logout = async () => {
    explicitlySigningOut.current = true
    generation.current++
    authVersion.current++
    cacheEpoch.current++
    if (liveRef.current) liveRef.current.store.readOnly = true
    setStatus('checking'); setBusy(true)
    try {
      await signOut(() => { setCached(undefined); setLive(undefined); setMode('live') })
      setCached(undefined); setLive(undefined); setSession(null); setMode('live')
      setCollaboration(undefined); setError(''); setCacheError(''); setStatus('auth')
    } catch (error) {
      setCacheError(`Sign out could not be completed: ${message(error)}. Retry clearing this device.`)
      setStatus('error')
      throw error
    } finally { explicitlySigningOut.current = false; setBusy(false); setDownloading(false) }
  }

  const retryLive = () => { setRetry(value => value + 1) }
  const clearDownloads = async () => {
    generation.current++
    cacheEpoch.current++
    await offlineDownloads.clearAll()
    setCached(undefined); setCacheError(''); setDownloading(false)
  }
  const removeDownload = async () => {
    const snapshot = cachedRef.current
    if (!snapshot) return
    try {
      await offlineDownloads.remove(snapshot.userId, snapshot.tripId)
      setCached(undefined); setDownloadError('')
    } catch (error) { setDownloadError(message(error)); throw error }
  }
  const download = async () => {
    if (!live || status !== 'ready' || !navigator.onLine) return
    const version = generation.current
    const epoch = cacheEpoch.current
    setDownloading(true); setDownloadError(''); setProgress('Preparing download…')
    try {
      const snapshot = await offlineDownloads.download(live.userId, live.trip.id, getCloudClient(), text => {
        if (version === generation.current) setProgress(text)
      })
      if (version === generation.current && epoch === cacheEpoch.current) setCached(snapshot)
    } catch (error) {
      if (version !== generation.current) return
      setDownloadError(message(error))
      if (isAuthorizationError(error) || membershipDenied(error)) {
        live.store.readOnly = true; setStatus('auth'); setCached(undefined); setLive(undefined)
        if (membershipDenied(error)) {
          cacheEpoch.current++
          try { await offlineDownloads.invalidateUser(live.userId) } catch (storageError) { setCacheError(message(storageError)) }
        }
      }
    } finally { if (version === generation.current) { setDownloading(false); setProgress('') } }
  }
  const downloads: DownloadControls = {
    savedAt: cached?.savedAt, downloading, progress, error: [cacheError, downloadError, error].filter(Boolean).join(' ') || undefined,
    onDownload: live && status === 'ready' && online && mode === 'live' ? download : undefined,
    onRemove: removeDownload,
    onUseDownload: cached && mode === 'live' ? () => {
      if (!hasOpenEditor() || window.confirm('Open the saved, read-only trip? Any unsaved editor contents will be discarded.')) setMode('download')
    } : undefined,
    onReturnLive: mode === 'download' && online ? () => {
      returnRequested.current = true
      retryLive()
    } : undefined,
    onSignOut: logout,
  }

  if (live) {
    live.store.readOnly = status !== 'ready' || !online || mode === 'download'
    live.store.onUnavailable = error => {
      setError(message(error))
      if (isAuthorizationError(error) || membershipDenied(error)) {
        setStatus('auth'); setLive(undefined); setCached(undefined)
        if (membershipDenied(error)) {
          cacheEpoch.current++
          void offlineDownloads.invalidateUser(live.userId).catch(error => setCacheError(message(error)))
        }
      }
      else setStatus('network')
    }
  }
  const repository = live ? new CloudNotebookRepository(live.trip.id) : undefined
  const requireVerified = () => {
    if (!navigator.onLine || statusRef.current !== 'ready' || liveRef.current?.store.readOnly) {
      throw new Error('Reconnect and verify your account before editing. Nothing was saved.')
    }
  }
  const refreshCollaboration = async () => setCollaboration(await repository!.collaborationStatus())
  const account: CloudAccountControls | undefined = live && session ? {
    email: session.user.email ?? 'Signed-in account',
    role: collaboration?.role ?? live.trip.role,
    pendingEmail: collaboration?.pendingEmail ?? null,
    claimedEmail: collaboration?.claimedEmail ?? null,
    claimedUserId: collaboration?.claimedUserId ?? null,
    async share(email) { requireVerified(); await repository!.shareWithEmail(email); await refreshCollaboration() },
    async revokePending() { requireVerified(); await repository!.revokePendingShare(); await refreshCollaboration() },
    async removeEditor(id) { requireVerified(); await repository!.removeClaimedEditor(id); await refreshCollaboration() },
    signOut: logout,
  } : undefined

  if (setupIssue) return <CloudEntry title="Cloud setup needed"><p>{setupIssue}</p></CloudEntry>
  // Auth failure while online must never be dressed up as a successful cached sign-in.
  if (status !== 'auth' && mode === 'download' && cached && downloadStore &&
    (!session || session.user.id === cached.userId)) {
    return <NotebookApplication store={downloadStore} initialData={cached.notebook} readOnly downloads={downloads}/>
  }
  if (live && status !== 'auth' && mode === 'live') {
    return <NotebookApplication store={live.store} initialData={live.notebook} account={account}
      readOnly={status !== 'ready' || !online}
      readOnlyReason="Connection unavailable or account verification pending. Your open work is kept here; no offline changes are saved."
      downloads={downloads}/>
  }
  if (!online || status === 'network' || (mode === 'download' && !cached && status !== 'auth')) {
    return <CloudEntry title={!cacheLoaded ? 'Opening your downloaded trip' : 'No downloaded trip on this device'}>
      <p>{cacheLoaded ? 'Reconnect and sign in to download a complete trip. Offline changes are never queued.' : 'Reading this device’s saved trip…'}</p>
      {(cacheError || error) && <p role="alert">{cacheError || error}</p>}
      {online && <button className="save" onClick={() => { setMode('live'); returnRequested.current = true; retryLive() }}>Retry connection</button>}
      <button className="text-action" disabled={busy} onClick={() => void logout().catch(() => {})}>Sign out and clear this device</button>
      {cacheError && <button onClick={() => void clearDownloads().catch(error => setCacheError(message(error)))}>Clear downloaded trips</button>}
    </CloudEntry>
  }
  if (status === 'auth' || session === null) {
    return <CloudEntry title="Your shared travel notebook">
      <EmailSignIn onSignedIn={next => { setStatus('checking'); setSession(next); retryLive() }}/>
      {(error || cacheError) && <p role="alert">{[error, cacheError].filter(Boolean).join(' ')}</p>}
      <button className="text-action" disabled={busy} onClick={() => void logout().catch(() => {})}>Sign out and clear this device</button>
    </CloudEntry>
  }
  if (status === 'error') return <CloudEntry title="Could not load your trip">
    <p role="alert">{cacheError || error || 'Check your connection and try again.'}</p>
    <button className="save" onClick={retryLive}>Retry</button>
    <button disabled={busy} onClick={() => void logout().catch(() => {})}>Sign out and clear this device</button>
  </CloudEntry>
  if (session === undefined || status === 'checking') return <CloudEntry title="Opening your notebook"><p>Checking your account and loading your shared trip…</p>{cacheError && <p role="alert">{cacheError}</p>}</CloudEntry>
  return <CloudEntry title="Create your Cape Town notebook">
    <p>Signed in as <strong>{session?.user.email}</strong>. This creates the fresh 21–28 September 2026 plan once, without importing browser test data.</p>
    <button className="save cloud-create" disabled={busy} onClick={() => {
      if (status !== 'ready' || !navigator.onLine) return
      setBusy(true); setError('')
      void bounded(createFreshTrip()).then(retryLive).catch(error => setError(message(error))).finally(() => setBusy(false))
    }}>Create Cape Town 2026</button>
    <button className="text-action cloud-sign-out" disabled={busy} onClick={() => void logout().catch(() => {})}>Sign out</button>
    {(error || cacheError) && <p role="alert">{cacheError || error}</p>}
  </CloudEntry>
}

function CloudEntry({ title, children }: { title: string; children: ReactNode }) {
  return <main className="cloud-entry">
    <div className="cloud-facades" aria-hidden="true"><i/><i/><i/><i/></div>
    <section className="cloud-entry-card"><span className="stamp-mark">CT</span><h1>{title}</h1>{children}</section>
  </main>
}
