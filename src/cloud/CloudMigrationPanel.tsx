import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppData } from '../types'
import { parseBackup } from '../backup'
import { currentSession, requestSignIn, signOut } from './auth'
import { getCloudClient } from './client'
import { cloudSetupIssue } from './config'
import { importNotebook, summarizeImport } from './import'

export function CloudMigrationPanel({ localData, onExport }: { localData: AppData; onExport: () => void }) {
  const setupIssue = cloudSetupIssue()
  const [session, setSession] = useState<Session | null>()
  const [source, setSource] = useState<AppData>(localData)
  const [sourceLabel, setSourceLabel] = useState('This browser')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageVersion, setMessageVersion] = useState(0)
  const batchId = useRef(crypto.randomUUID())
  const showMessage = (next: string) => { setMessage(next); setMessageVersion(version => version + 1) }

  useEffect(() => {
    if (setupIssue) return
    const client = getCloudClient()
    currentSession().then(setSession).catch(error => showMessage(error instanceof Error ? error.message : 'Sign-in status could not be loaded.'))
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [setupIssue])
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 20_000)
    return () => window.clearTimeout(timer)
  }, [message, messageVersion])

  if (setupIssue) return <section className="settings-panel cloud-panel"><h3>Shared access</h3><p className="caption">{setupIssue}</p></section>

  const summary = summarizeImport(source)
  const sendLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true); setMessage('')
    try {
      const email = String(new FormData(event.currentTarget).get('email'))
      await requestSignIn(email)
      showMessage('Check your email for the sign-in link.')
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Sign-in failed.') }
    finally { setBusy(false) }
  }
  const chooseZip = async (file: File) => {
    setBusy(true); setMessage('')
    try {
      setSource(await parseBackup(file))
      setSourceLabel(file.name)
      setBackupConfirmed(false)
      batchId.current = crypto.randomUUID()
    } catch (error) { showMessage(error instanceof Error ? error.message : 'The backup could not be read.') }
    finally { setBusy(false) }
  }
  const upload = async () => {
    setBusy(true); setMessage('')
    try {
      await importNotebook(source, batchId.current)
      showMessage('Import complete. Your browser copy has not been changed.')
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Import failed. Nothing was marked complete.') }
    finally { setBusy(false) }
  }

  if (!session) return <section className="settings-panel cloud-panel"><h3>Shared access</h3><form className="form-card" onSubmit={sendLink}><label className="field">Email<input name="email" type="email" autoComplete="email" required/></label><button className="save" disabled={busy}>Email sign-in link</button></form>{message && <p className="caption" role="status">{message}</p>}</section>

  return <section className="settings-panel cloud-panel">
    <div className="cloud-heading"><div><h3>Move to shared access</h3><p className="caption">{session.user.email}</p></div><button className="text-action" onClick={() => signOut().catch(error => showMessage(String(error)))}>Sign out</button></div>
    <div className="import-summary"><strong>{summary.destination}</strong><span>{sourceLabel}</span><span>{summary.records} records · {summary.photos} photos · {(summary.photoBytes / 1024 / 1024).toFixed(1)} MB</span></div>
    <label className="backup-restore">Choose ZIP<input type="file" accept=".zip,application/zip" onChange={event => event.target.files?.[0] && chooseZip(event.target.files[0])}/></label>
    <button className="backup-export" onClick={onExport}>Export safety backup</button>
    <label className="import-confirm"><input type="checkbox" checked={backupConfirmed} onChange={event => setBackupConfirmed(event.target.checked)}/>I saved a safety backup and want to upload this notebook.</label>
    <button className="save" disabled={busy || !backupConfirmed} onClick={upload}>Import notebook</button>
    <p className="caption">The browser copy stays available until cloud access is verified.</p>
    {message && <p className="caption" role="status">{message}</p>}
  </section>
}
