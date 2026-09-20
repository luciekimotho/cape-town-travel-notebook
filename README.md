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

On the deployed HTTPS site, use the browser's **Add to Home Screen** or **Install app** action. While online and signed in, open **Settings → Downloaded trip → Download for offline use**. Wait until a successful download time appears before going offline. The copy includes all five notebook sections and the actual saved photo files, not temporary image URLs.

Downloaded trips are **read-only**: no edits, stamps, checklist updates, expense changes,
photo changes, restore, or sharing changes are queued. Google Maps needs a connection.
Choose **Update download** online to replace the copy; a failed or interrupted refresh
keeps the last complete download. **Remove downloaded copy** deletes only this device's
copy, not the shared trip.

Downloads are private, unencrypted device storage, isolated by the last verified
account and trip. Use a trusted device. A previously downloaded copy may be viewed
offline even after its login token expires; this is not a new offline sign-in.
The app cannot discover revoked access until it reconnects and checks membership.
Explicit sign-out clears the downloaded data and remembered account association.
Changing accounts clears the previous account's downloaded data. Server-confirmed
revocation removes its cached access; temporary network failures do not.

If a connection drops while editing, fields become read-only and the draft stays
open; the app never silently retries the write. You can explicitly open the saved
download instead. Once reconnected and verified, choose the live trip before editing.

The PWA service worker caches only app assets; private trip records and photos are
kept in a separate IndexedDB download database. The legacy browser-only notebook is
not replaced. Browser eviction or clearing site data can remove downloads—keep ZIP
backups too. First-time offline use without a complete download cannot show a trip.
Downloads use the existing stamp-aware RPCs from migration `0004`; this feature
requires no additional SQL migration.
Real iPhone/Android acceptance is still required; desktop simulation is not device
certification.

### Offline acceptance on a phone

1. Load the deployed app online, sign in, and download the trip in Settings.
2. Confirm its successful timestamp, then enable airplane mode and fully reopen
   the installed app at the same origin.
3. Browse Itinerary (including group children), Places, Moments/photos, Checklist,
   and Costs. Confirm the read-only label and disabled editing actions.
4. Reconnect, open the live trip, and explicitly update the download after a change.
5. Verify a failed refresh leaves the previous copy available, and removing the
   local copy does not remove the shared trip.

Saved addresses and Google Maps links remain editable in activity forms and appear only in activity details.

## Stamp designs

Place, activity, and activity-template forms include a **Stamp design** picker with
a live preview using the entry's own name. **Default** uses the neutral place mark;
**Automatic** keeps name-based matching; the other options use the existing destination
illustrations. New entries start with Default, while existing entries retain their
automatic artwork until edited.

An activity's selection overrides its place's default. Saved stamps retain their
selection in Moments and backups, including after an activity is deleted and its
memory becomes detached. Selecting artwork does not change visit dates or photos.
Cloud support requires `supabase/migrations/0004_stamp_designs.sql` after the prior
migrations; updating frontend assets alone is not sufficient.

## Supabase deployment

The notebook UI is connected to Supabase when `VITE_ENABLE_SUPABASE=true`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` alongside that flag in local `.env.local` and the GitHub Pages environment variables. Only the public publishable key belongs in the frontend; never use a service-role or secret key.

Cloud setup uses a fresh Cape Town 2026 bootstrap; existing browser data is not imported. It creates no test expenses, stamps, or photos and does not implement offline writes, dual-write synchronization, or an outbox.

Project setup and RLS verification steps are documented in `supabase/README.md`. Run the Dashboard-ready `supabase/migrations/0001_setup.sql` followed by the additive `supabase/migrations/0002_cloud_app.sql`, enable the approved Auth redirects, and test with disposable accounts before deploying cloud mode.

The Pages workflow publishes pushes to `main`. Sign-in links return to the origin where they were requested, so the deployed Pages URL must be an allowed Supabase Auth redirect. A local browser login does not sign you in on the deployed origin.

For an iPhone Home Screen installation, finish sign-in **inside the installed app**:
request an email, then enter its code in the app. If the email only contains a link,
copy that unopened link and choose **My email only has a sign-in link**. Opening it
in Safari signs in Safari, not necessarily the installed app. This copied-link fallback
can still fail if a preview or mail scanner consumes the link first. Prefer the
**code-only email template**, without a sign-in link, in `supabase/templates/magic-link.html`.
Apply it to Magic Link and Confirm signup in the Auth dashboard, then request a new
email. If Supabase locks template editing behind custom SMTP, that mail setup is a
prerequisite; an app deployment does not change it. Template setup and real-device
acceptance steps are in `supabase/IOS_SIGN_IN.md`.

## Artwork review

With the dev server running, open `/cape-town-travel-notebook/dev/asset-gallery.html` for the shared production artwork gallery. This review entry and its diagnostic fixtures are excluded from the production build and service-worker precache.
