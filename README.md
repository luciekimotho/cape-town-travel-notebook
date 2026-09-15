# Cape Town Travel Notebook

A private, local-first travel-planning PWA. Application records and photos stay in the browser's IndexedDB; no personal trip data is included in this repository or its deployment assets.

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
