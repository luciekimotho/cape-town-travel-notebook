# Cape Town Travel Notebook

A private travel-planning PWA. With Supabase enabled, the application uses authenticated shared trip records and private photo storage. No personal trip data is included in this repository or its deployment assets.

## Local development

```sh
npm install
npm run dev
```

Production preview:

```sh
npm run build
npm run preview
```

The deployed app is hosted on GitHub Pages at:

<https://luciekimotho.github.io/cape-town-travel-notebook/>

## Data safety

Export ZIP backups regularly. Backup files are unencrypted and contain the notebook's stored photo previews, so keep them private. In cloud mode, only the trip owner can restore a backup; membership is preserved. When Supabase is disabled, data stays in browser storage, which can be cleared or evicted.

Manual exchange rates and ZIP backup/restore are available from the Settings button in the app header. Each expense keeps the rate version active when it was recorded; later rate changes do not recalculate old expenses.

## Install and offline use

On the deployed HTTPS site, use the browser's **Add to Home Screen** or **Install app** action. The service worker caches the app shell, but shared trip access and changes require an internet connection. Cloud mode has no offline-write queue or synchronization. Google Maps and other external pages also require a connection. Real-device installation and offline behavior still require user acceptance checks.

Saved addresses and Google Maps links remain editable in activity forms and appear only in activity details.

## Supabase deployment

The notebook UI is connected to Supabase when `VITE_ENABLE_SUPABASE=true`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` alongside that flag in local `.env.local` and the GitHub Pages environment variables. Only the public publishable key belongs in the frontend; never use a service-role or secret key.

Cloud setup uses a fresh Cape Town 2026 bootstrap; existing browser data is not imported. It creates no test expenses, stamps, or photos and does not implement offline writes, dual-write synchronization, or an outbox.

Project setup and RLS verification steps are documented in `supabase/README.md`. Run the Dashboard-ready `supabase/migrations/0001_setup.sql` followed by the additive `supabase/migrations/0002_cloud_app.sql`, enable the approved Auth redirects, and test with disposable accounts before deploying cloud mode.

The Pages workflow publishes pushes to `main`. Sign-in links return to the origin where they were requested, so the deployed Pages URL must be an allowed Supabase Auth redirect. A local browser login does not sign you in on the deployed origin.

## Artwork review

With the dev server running, open `/cape-town-travel-notebook/dev/asset-gallery.html` for the shared production artwork gallery. This review entry and its diagnostic fixtures are excluded from the production build and service-worker precache.
