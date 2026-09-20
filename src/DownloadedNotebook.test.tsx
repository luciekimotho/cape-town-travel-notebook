import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotebookApplication, type DownloadControls } from './App'
import { DownloadSettings } from './DownloadSettings'
import { db, initializeDatabase, loadData } from './db'
import { localNotebookStore, type NotebookStore } from './notebookStore'

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete(); await db.open(); await initializeDatabase()
})
afterEach(cleanup)

const controls = (): DownloadControls => ({
  savedAt: '2026-09-18T12:00:00Z', downloading: false,
  onDownload: vi.fn().mockResolvedValue(undefined),
  onRemove: vi.fn().mockResolvedValue(undefined),
  onReturnLive: vi.fn(),
})

describe('downloaded notebook browsing', () => {
  it('retains all five tabs and disables mutation entry points', async () => {
    const notebook = await loadData()
    const store: NotebookStore = { ...localNotebookStore, kind: 'download', readOnly: true }
    const write = vi.spyOn(store, 'saveItineraryDetails')
    render(<NotebookApplication store={store} initialData={notebook} downloads={controls()}/>)
    expect(screen.getByText('Downloaded trip · read-only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add activity' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Arrive in Cape Town/ }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stamp this visit' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Open in Google Maps' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Itinerary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Places' }))
    expect(screen.getByRole('button', { name: 'Add place' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Table Mountain.*activity/ }))
    expect(screen.getByLabelText('Name *')).toBeDisabled()
    expect(screen.getByLabelText('Day')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save activity' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close Activity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Checklist' }))
    expect(screen.getByRole('button', { name: 'Add reminder' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: /^(Complete|Uncheck) / })) expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Costs' }))
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeDisabled()
    for (const button of within(screen.getByRole('group', { name: 'Display currency' })).getAllByRole('button')) expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Moments' }))
    expect(screen.getByRole('heading', { name: /Moments/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(screen.getByRole('button', { name: 'Activate rates' })).toBeDisabled()
    expect(screen.queryByLabelText('Restore')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export ZIP' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove downloaded copy' })).toBeEnabled()
    expect(write).not.toHaveBeenCalled()
  })

  it('preserves an open draft while a connection loss makes the live view read-only', async () => {
    const notebook = await loadData()
    const store: NotebookStore = { ...localNotebookStore }
    const save = vi.spyOn(store, 'saveItineraryDetails')
    const view = render(<NotebookApplication store={store} initialData={notebook}/>)
    fireEvent.click(screen.getByRole('button', { name: /Arrive in Cape Town/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Unsaved travel plan' } })
    view.rerender(<NotebookApplication store={store} initialData={notebook} readOnly/>)
    expect(screen.getByLabelText('Name *')).toHaveValue('Unsaved travel plan')
    expect(screen.getByLabelText('Name *')).toBeDisabled()
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('read-only')
    view.rerender(<NotebookApplication store={store} initialData={notebook}/>)
    expect(screen.getByLabelText('Name *')).toBeEnabled()
    expect(screen.getByLabelText('Name *')).toHaveValue('Unsaved travel plan')
  })

  it('shows offline photo blobs without offering edit or deletion actions', async () => {
    const notebook = await loadData()
    notebook.stamps.push({ id: 'offline-stamp', placeName: 'My view', stampKind: 'lighthouse', visitDate: '2026-09-25', detached: true, createdAt: '2026-09-25' })
    notebook.photos.push({ id: 'offline-photo', stampId: 'offline-stamp', caption: 'Saved sea view', mimeType: 'image/png', width: 1, height: 1, size: 5, blob: new Blob(['photo'], { type: 'image/png' }), createdAt: '', updatedAt: '' })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:offline-photo')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const store: NotebookStore = { ...localNotebookStore, kind: 'download', readOnly: true }
    const view = render(<NotebookApplication store={store} initialData={notebook}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Moments' }))
    expect(screen.getByAltText('Saved sea view')).toHaveAttribute('src', 'blob:offline-photo')
    fireEvent.click(screen.getByRole('button', { name: /My view travel stamp/ }))
    expect(screen.getByRole('button', { name: 'Delete memory' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit photo' })).toBeDisabled()
    expect(document.querySelector('[data-stamp-kind="lighthouse"]')).not.toBeNull()
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:offline-photo')
  })
})

describe('download controls', () => {
  it('does not claim completion while a refresh is pending or failed', async () => {
    const actions = controls()
    actions.downloading = true
    actions.progress = 'Downloading photo 2 of 3'
    const view = render(<DownloadSettings controls={actions}/>)
    expect(screen.getByRole('button', { name: 'Update download' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('photo 2 of 3')
    actions.downloading = false
    actions.onDownload = vi.fn().mockRejectedValue(new Error('Storage quota exceeded'))
    view.rerender(<DownloadSettings controls={actions}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Update download' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage quota exceeded')
    expect(screen.getByText(/Last downloaded/)).toBeInTheDocument()
  })

  it('confirms removing the local copy and surfaces storage errors', async () => {
    const actions = controls()
    actions.onRemove = vi.fn().mockRejectedValue(new Error('Could not remove download'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DownloadSettings controls={actions}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Remove downloaded copy' }))
    expect(actions.onRemove).not.toHaveBeenCalled()
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove downloaded copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove download')
  })
})
