import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { cloudFeatureEnabled } from './cloud/config'
import { registerSW } from 'virtual:pwa-register'

const CloudApp = lazy(() => import('./cloud/CloudApp'))

registerSW({
  immediate: true,
  onOfflineReady() {
    window.dispatchEvent(new Event('offline-ready'))
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {cloudFeatureEnabled?<Suspense fallback={<main className="loading"><span className="stamp-mark">CT</span><p>Opening your notebook…</p></main>}><CloudApp/></Suspense>:<App/>}
  </StrictMode>,
)
