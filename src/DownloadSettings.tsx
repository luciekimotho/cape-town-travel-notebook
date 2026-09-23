import { useState } from 'react'
import type { DownloadControls } from './App'
import { errorMessage } from './errorMessage'
import { LineIcon } from './Artwork'

export function DownloadSettings({ controls }: { controls: DownloadControls }) {
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setError('')
    try { await action() } catch (error) { setError(errorMessage(error, 'Check your connection and device storage, then try again.')) }
  }
  return <section className="settings-panel download-panel">
    <div className="settings-panel-heading"><span className="settings-symbol"><LineIcon name="download"/></span><h3>Offline copy</h3></div>
    <p className="caption">A complete trip you viewed is kept on this device when storage allows. Use a trusted device.</p>
    {controls.savedAt ? <p className="download-timestamp">Offline copy ready · {new Date(controls.savedAt).toLocaleString()}</p> : <p className="caption">No offline copy on this installed app yet.</p>}
    {controls.refreshing && <p className="caption" role="status">Showing the saved trip while checking for updates…</p>}
    {controls.savedAt && controls.persistence === 'granted' && <p className="caption">Protected from routine browser storage cleanup.</p>}
    {controls.savedAt && controls.persistence === 'denied' && <p className="caption">iPhone may remove this copy when storage is low. Open this installed app online to refresh it.</p>}
    {controls.savedAt && controls.persistence === 'unsupported' && <p className="caption">Storage protection is unavailable in this browser. Open this installed app online before travel.</p>}
    {controls.downloading && <p className="caption" role="status">{controls.progress || 'Downloading trip and photos…'}</p>}
    {(error || controls.error) && <p className="download-error" role="alert">{error || controls.error}</p>}
    <div className="download-actions">
      {controls.onDownload && <button className="save" disabled={controls.downloading || removing} onClick={() => void run(controls.onDownload!)}>{controls.savedAt ? 'Verify photos for offline use' : 'Download for offline use'}</button>}
      {controls.savedAt && controls.onUseDownload && <button className="ghost" disabled={removing} onClick={controls.onUseDownload}>View downloaded trip</button>}
      {controls.onReturnLive && <button className="ghost" disabled={removing} onClick={controls.onReturnLive}>Open live trip</button>}
      {controls.savedAt && <button className="text-action" disabled={removing} onClick={() => {
        if (!confirm('Remove the downloaded copy from this device? Your shared trip and photos stay in Supabase.')) return
        setRemoving(true)
        void run(controls.onRemove).finally(() => setRemoving(false))
      }}>{removing ? 'Removing…' : 'Remove downloaded copy'}</button>}
      {controls.onSignOut && <button className="text-action" disabled={removing || controls.downloading} onClick={() => void run(controls.onSignOut!)}>Sign out and remove download</button>}
    </div>
  </section>
}
