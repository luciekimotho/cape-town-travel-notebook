import { useState } from 'react'
import type { DownloadControls } from './App'
import { errorMessage } from './errorMessage'
import { LineIcon } from './Artwork'

export function DownloadSettings({ controls }: { controls: DownloadControls }) {
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setError('')
    try { await action() } catch (error) { setError(errorMessage(error, 'The downloaded copy could not be updated.')) }
  }
  return <section className="settings-panel download-panel">
    <div className="settings-panel-heading"><span className="settings-symbol"><LineIcon name="download"/></span><h3>Downloaded trip</h3></div>
    <p className="caption">Keep your itinerary and photos on this device for read-only viewing. Use a trusted device.</p>
    {controls.savedAt ? <p className="download-timestamp">Last downloaded {new Date(controls.savedAt).toLocaleString()}</p> : <p className="caption">No downloaded copy yet.</p>}
    {controls.downloading && <p className="caption" role="status">{controls.progress || 'Downloading trip and photos…'}</p>}
    {(error || controls.error) && <p className="download-error" role="alert">{error || controls.error}</p>}
    <div className="download-actions">
      {controls.onDownload && <button className="save" disabled={controls.downloading || removing} onClick={() => void run(controls.onDownload!)}>{controls.savedAt ? 'Update download' : 'Download for offline use'}</button>}
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
