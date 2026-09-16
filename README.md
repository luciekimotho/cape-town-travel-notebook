# Cape Town Travel Notebook

A private travel-planning PWA. The deployed application currently stores records and photos in the browser's IndexedDB; no personal trip data is included in this repository or its deployment assets.

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

Browser storage can be cleared or evicted. Export ZIP backups regularly. Backup files are unencrypted and contain the notebook's stored photo previews, so keep them private.

Manual exchange rates and ZIP backup/restore are available from the Settings button in the app header. Each expense keeps the rate version active when it was recorded; later rate changes do not recalculate old expenses.

## Install and offline use

On the deployed HTTPS site, use the browser's **Add to Home Screen** or **Install app** action. The service worker caches the app shell for offline use, but Google Maps and other external pages still require a connection. Browser storage and offline-cache diagnostics are intentionally not shown in the personal app interface.

Saved addresses and Google Maps links remain editable in activity forms and appear only in activity details.

## Supabase foundation

The `supabase-foundation` branch contains an opt-in online-first collaboration foundation. It is disabled unless `VITE_ENABLE_SUPABASE=true` and a public Supabase project URL and publishable client key are provided. Never put a service-role or secret key in frontend environment variables.

The planned cutover is a one-time, owner-confirmed import from the existing browser notebook or a validated ZIP. It preserves IDs, group links, recorded expense dates/rate snapshots, stamp/photo relationships, and photo bytes. It does not delete the browser database, and it does not implement offline writes, dual-write synchronization, or an outbox.

Project setup and RLS verification steps are documented in `supabase/README.md`. Applying the migration, enabling the approved Auth redirects, and testing with disposable accounts are required before cloud mode can be deployed or real notebook data can be imported.
