import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { NotebookApplication, TransientNotice, type CloudAccountControls } from '../App'
import { claimSharedTrip, consumeAuthCallbackError, currentSession, signOut } from './auth'
import { EmailSignIn } from './EmailSignIn'
import { getCloudClient } from './client'
import { cloudSetupIssue } from './config'
import { CloudNotebookStore } from './notebookStore'
import { CloudNotebookRepository, createFreshTrip, listCloudTrips, type CloudTripSummary, type CollaborationStatus } from './repository'

export default function CloudApp() {
  const setupIssue = cloudSetupIssue()
  const [session, setSession] = useState<Session | null>()
  const [trip, setTrip] = useState<CloudTripSummary>()
  const [collaboration, setCollaboration] = useState<CollaborationStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(consumeAuthCallbackError)
  const [errorVersion, setErrorVersion] = useState(error ? 1 : 0)
  const [notice, setNotice] = useState('')
  const [noticeVersion, setNoticeVersion] = useState(0)
  const [tripsLoading, setTripsLoading] = useState(true)
  const [tripLoadFailed, setTripLoadFailed] = useState(false)
  const [retryTrips, setRetryTrips] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const store = useMemo(() => trip ? new CloudNotebookStore(trip.id) : undefined, [trip])
  const repository = useMemo(() => trip ? new CloudNotebookRepository(trip.id) : undefined, [trip])
  const showError = (message: string) => { setError(message); setErrorVersion(version => version + 1) }
  const showNotice = (message: string) => { setNotice(message); setNoticeVersion(version => version + 1) }

  const loadTrips = async () => {
    await claimSharedTrip()
    const trips = await listCloudTrips()
    setTrip(trips[0])
  }

  useEffect(() => {
    if (setupIssue) return
    let active = true
    const client = getCloudClient()
    let receivedAuthEvent = false
    currentSession().then(next => {
      if (!active) return
      if (!receivedAuthEvent) setSession(next)
    }).catch(error => active && showError(error instanceof Error ? error.message : 'Sign-in status could not be loaded.'))
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      receivedAuthEvent = true
      setSession(next)
      if (!next) { setTrip(undefined); setCollaboration(undefined) }
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [setupIssue])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let active = true
    setTripsLoading(true); setTripLoadFailed(false)
    // Auth callbacks run under the SDK's session lock. Load data outside that callback.
    void (async () => {
      try {
        await claimSharedTrip()
        const trips = await listCloudTrips()
        if (active) setTrip(trips[0])
      } catch (error) {
        if (active) { setTripLoadFailed(true); showError(error instanceof Error ? error.message : 'Your trip could not be loaded. Please retry.') }
      } finally { if (active) setTripsLoading(false) }
    })()
    return () => { active = false }
  }, [userId, retryTrips])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => {
    if (!repository) { setCollaboration(undefined); return }
    repository.collaborationStatus().then(setCollaboration).catch(error => showError(error instanceof Error ? error.message : String(error)))
  }, [repository])

  const run = async (operation: () => Promise<unknown>, success?: string) => {
    if (!navigator.onLine) { showError('Cloud editing needs an internet connection. Nothing was saved.'); return false }
    setBusy(true); setError(''); setNotice('')
    try {
      await operation()
      if (success) showNotice(success)
      return true
    } catch (error) {
      showError(error instanceof Error ? error.message : 'The cloud request failed. Please retry.')
      return false
    } finally { setBusy(false) }
  }

  if (setupIssue) return <CloudEntry title="Cloud setup needed"><p>{setupIssue}</p></CloudEntry>
  if (!online) return <CloudEntry title="You’re offline"><p>Your shared notebook is online-only. Reconnect to view or edit it; no offline changes are queued.</p></CloudEntry>
  if (session === undefined) return <CloudEntry title="Opening your notebook"><p>Checking your secure session…</p></CloudEntry>
  if (!session) {
    return <CloudEntry title="Your shared travel notebook">
      <EmailSignIn onSignedIn={setSession}/>
      {error&&<TransientNotice message={error} version={errorVersion} tone="error" onDismiss={()=>setError('')}/>}
      {!error&&notice&&<TransientNotice message={notice} version={noticeVersion} onDismiss={()=>setNotice('')}/>}
    </CloudEntry>
  }
  if (tripsLoading) return <CloudEntry title="Opening your notebook"><p>Loading your shared trip…</p></CloudEntry>
  if (tripLoadFailed) return <CloudEntry title="Could not load your trip"><p role="alert">{error || 'Check your connection and try again.'}</p><button className="save" onClick={() => setRetryTrips(value => value + 1)}>Retry</button></CloudEntry>
  if (!trip || !store || !repository) {
    return <CloudEntry title="Create your Cape Town notebook">
      <p>Signed in as <strong>{session.user.email}</strong>. This creates the fresh 21–28 September 2026 plan once, without importing browser test data.</p>
      <button className="save cloud-create" disabled={busy} onClick={()=>run(async()=>{await createFreshTrip();await loadTrips()},'Cape Town 2026 created.')}>Create Cape Town 2026</button>
      <button className="text-action cloud-sign-out" onClick={()=>signOut().catch(error=>showError(String(error)))}>Sign out</button>
      {error&&<TransientNotice message={error} version={errorVersion} tone="error" onDismiss={()=>setError('')}/>}
    </CloudEntry>
  }

  const refreshCollaboration = async () => setCollaboration(await repository.collaborationStatus())
  const account: CloudAccountControls = {
    email:session.user.email ?? 'Signed-in account',
    role:collaboration?.role ?? trip.role,
    pendingEmail:collaboration?.pendingEmail ?? null,
    claimedEmail:collaboration?.claimedEmail ?? null,
    claimedUserId:collaboration?.claimedUserId ?? null,
    async share(email) { await repository.shareWithEmail(email); await refreshCollaboration() },
    async revokePending() { await repository.revokePendingShare(); await refreshCollaboration() },
    async removeEditor(userId) { await repository.removeClaimedEditor(userId); await refreshCollaboration() },
    async signOut() {
      await signOut()
      setTrip(undefined)
      setCollaboration(undefined)
      setSession(null)
    },
  }
  return <NotebookApplication store={store} account={account}/>
}

function CloudEntry({ title, children }: { title: string; children: ReactNode }) {
  return <main className="cloud-entry">
    <div className="cloud-facades" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <section className="cloud-entry-card"><span className="stamp-mark">CT</span><h1>{title}</h1>{children}</section>
  </main>
}
