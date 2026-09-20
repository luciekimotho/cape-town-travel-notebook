# Supabase setup

The complete cloud setup uses five application migrations plus three reviewed user-data updates:

| Migration | Contents |
| --- | --- |
| `0001_setup.sql` | Core domain schema and integrity; profiles and two-person exact-email sharing; RLS/grants; list/load and Cape Town bootstrap RPCs; private photo Storage |
| `0002_cloud_app.sql` | Additive grouped bootstrap, transactional app mutations, collaboration controls, safe photo replacement, and owner-only validated ZIP restore |
| `0003_fix_itinerary_edit.sql` | Schema-qualifies the deferred parent constraint so editing activities works with the RPC's restricted search path; changes no trip data |
| `0004_stamp_designs.sql` | Optional validated stamp designs, live/detached snapshots, design-aware read/mutation/restore RPCs; leaves existing choices automatic |
| `0005_confirmed_reservations.sql` | One-time, fail-safe update for the supplied confirmed flights and Hyatt stay; excludes passenger, ticket, seat and booking identifiers |
| `0006_itinerary_links.sql` | Provider-restricted GetYourGuide/Google Maps links on itinerary items, including read/mutation/restore RPC support |
| `0007_itinerary_link_data.sql` | Reviewed product links on tour groups and Google Maps area links on relevant personal itinerary stops |
| `0008_boarding_et309_now.sql` | Confirmed ET309 boarding activity at 01:30 Nairobi time; updates the existing travel-day group and boarding stop without duplicating either |

Apply `migrations/0001_setup.sql` through the normal migration runner (for example,
`supabase db push`) after confirming the target Supabase project. Then apply
`migrations/0002_cloud_app.sql`. The second file is deliberately additive because
`0001_setup.sql` may already be installed.
Then apply `migrations/0003_fix_itinerary_edit.sql` and `migrations/0004_stamp_designs.sql`
in order. If the first three are already installed, run only `0004_stamp_designs.sql`;
do not recreate the schema or bootstrap the trip. The fourth migration is transactional
and intended to run once. It explicitly checks that the third migration is installed.

For Dashboard-only setup:

1. Open **SQL Editor → New query**, review the target project, paste the complete contents of `migrations/0001_setup.sql`, and run it once.
2. Open another new query, paste `migrations/0002_cloud_app.sql`, and run it once.
   Then run `migrations/0003_fix_itinerary_edit.sql` in a new query.
   Finally run the complete `migrations/0004_stamp_designs.sql` in another new query.
   Run `migrations/0005_confirmed_reservations.sql` only for the intended personal notebook after reviewing its confirmed travel details.
   Then run `migrations/0006_itinerary_links.sql`, followed by the personal
   `migrations/0007_itinerary_link_data.sql`. Run `migrations/0008_boarding_et309_now.sql`
   only after confirming the live ET309 boarding update.
3. Configure the Authentication Site URL and Redirect URLs for the deployed and local app.
4. Keep passwordless email sign-in enabled.
5. Verify the `trip-photos` Storage bucket exists and is private.
6. Test owner, editor, exact-email claim, and outsider behavior with ordinary authenticated users.

Never put a `service_role` key in frontend code. Clients use the anon key with an
authenticated session; RLS remains the authorization boundary.

## Email and password

Keep **Authentication → Providers → Email** enabled. Existing members may set a
password from the app after verified email sign-in. The app updates that same
authenticated user with `auth.updateUser({ password })`; it never calls `signUp`,
creates a replacement account, or enables anonymous authentication. Password sign-in
therefore retains the user's UUID and existing trip membership.

Password login itself does not require custom SMTP. First-time invited travellers
still need one verified-email login to claim exact-email access before setting a
password. Recovery uses Email code/link sign-in followed by setting a new password;
the app deliberately does not expose a redirect-based forgot-password flow while
iOS standalone-link handling and live email delivery remain constrained.

## Fresh Cape Town data

After the intended owner signs in, call:

```sql
create_capetown_2026_trip_v2() returns uuid
```

The authenticated, security-definer v2 RPC calls the original idempotent bootstrap, then
creates one activity-group parent per day and nests the 32 fixed itinerary entries beneath
those eight parents with compact child positions. Both parents and children remain
independently stampable. It returns the same trip UUID on retries.

The additive v2 wrapper can also upgrade an existing v1 bootstrap, but only while all 32
fixed items retain their exact initial structure/audit state and no expense, stamp, or
photo exists. It refuses partially edited data instead of guessing. A
`system.layout=capetown-2026-grouped-v2` marker makes subsequent calls no-ops.

The seed deliberately creates no expenses, travel stamps, or photos. Accommodation,
golf-course, and Winelands candidates remain unselected/unbooked options. The trip starts
with one owner and can be shared with one editor.

The active rate set is effective **2026-09-16** and labeled
`ExchangeRate-API — 2026-09-16`:

- `KES/KES = 1`
- `KES/USD = 129.5336787565` (`1 / 0.00772`)
- `KES/ZAR = 8.0547724527` (`1 / 0.12415`)

Source: [ExchangeRate-API](https://www.exchangerate-api.com/). Retrieval timestamp recorded
for this bootstrap: **2026-09-16T10:25:03.518+03:00**.

## Exact-email sharing

### Email codes for iOS Home Screen sign-in

iOS Home Screen apps and Safari can use separate session storage. Complete
verification inside the notebook instead of expecting a link opened in Mail/Safari
to authenticate the installed app.

If the Dashboard requires custom SMTP before editing templates, configure an
approved mail provider first; the repository template is not applied by deployment.
In **Authentication → Email Templates**, set both **Magic Link** and **Confirm signup**
to the code-only content in `templates/magic-link.html` (preserve `{{ .Token }}`,
remove old sign-in buttons and all `{{ .ConfirmationURL }}` links). Email scanners
and iOS link previews can consume a one-time link before the app verifies it, even
when a numeric code is also included. This is an Auth dashboard setting, not a SQL migration.
The numeric code is verified by `verifyOtp` in the current app, where Supabase
persists and refreshes that session. No token is passed through another browser.

Until the templates are updated, the sign-in form's **My email only has a sign-in
link** option accepts the original copied, unopened Supabase confirmation link.
It validates the project URL and verification type, then verifies its token hash
through the app's Supabase client without following the URL or its redirect.
Already-consumed links, browser address-bar URLs, recovery links and tracked/wrapped
URLs are not supported. This fallback is vulnerable to link previews consuming the
credential; use code-only emails for dependable iOS entry. No credentials are placed
in logs or application URLs.

If iOS reloads the app while viewing email, enter the same email address and choose
**I already have a code or link**, avoiding another email request.
Email quota limits still apply; this change does not bypass them or configure SMTP.

Real-device acceptance (not covered by desktop automation):
1. Open the deployed notebook from the iPhone Home Screen and request an email.
2. View the email without opening its sign-in link; return to the installed app.
3. Enter the code, or copy the unopened link and use the link option.
4. Confirm the existing itinerary loads without creating a new trip.
5. Close and reopen the installed app; confirm the session remains signed in.
6. Repeat after token refresh and test a failed/expired code, then repeat normal browser login.

```sql
share_trip_with_email(p_trip_id uuid, p_email text) returns void
revoke_trip_email_access(p_trip_id uuid) returns void
claim_trip_access() returns setof uuid
```

An owner authorizes one exact email as editor. After every sign-in, the client calls
`claim_trip_access()` before listing trips. The claim verifies the JWT email against the
confirmed `auth.users` email, row-locks pending access, creates the editor membership, and
marks access claimed. There are no invitation tokens, hashes, links, or expiries.

Pending access can be replaced or revoked by the owner. Claimed collaborators are managed
through owner-only membership controls. A trip is limited to two members in this workflow;
the partial unique index also permits at most one editor.

## Listing and loading

```sql
list_notebook_trips()
load_notebook_v5(p_trip_id uuid) returns jsonb
```

`list_notebook_trips()` returns caller memberships as:

```text
{ id: uuid, destination: text, role: "owner" | "editor", updated_at: timestamptz }
```

`load_notebook_v5` returns `NULL` unless the caller is a member. Its response uses the
application's camel-case v4 domain shape and includes trip, checklist, days, items, places,
activity templates, expenses, stamps, photo metadata, rate sets, and notebook metadata.
The RPC version is not the backup schema version: ZIP backups remain schema 4.
The new read wrapper retains both existing read layers, including private photo paths.

## Mutations

### Stamp designs

Places, itinerary items, activity templates, and stamp snapshots accept optional
`stampKind`: `auto`, `mountain`, `penguin`, `house`, `cape`, `lighthouse`, `road`,
`boat`, `huts`, `promenade`, `wine`, `cliff`, or `pin`. JSON omission remains valid
for legacy schema-4 backups; invalid strings and explicit JSON `null` are rejected.
`pin` is the neutral **Default** icon with the real place name. `auto` explicitly
resets to name-based matching, overriding an inherited place choice.

Items use `item.stampKind ?? place.stampKind ?? 'auto'`. A template's choice is the
default for its new parent or single activity only; child stops inherit their own
place choices. Creation snapshots the persisted effective choice; later item/place
edits refresh linked stamps without rewriting their historical name/date. Deleting
an activity detaches its memory with the final effective choice.

Migration 0004 moves the original implementations into internal helpers (no authenticated
execute grant). Both legacy and new public RPC names delegate to the design-aware
implementations with null-safe membership/ownership guards. Existing deployed and cached
clients can keep saving before the frontend release: omitted mutation fields leave choices
unchanged, and `load_notebook_v4` includes choices so their schema-4 exports and restores
retain them. Truly legacy backups without choices still restore automatic behavior.
Updated clients require the new RPCs and report a missing-migration error rather than
silently losing selections. The migration does not update existing trip records or change
photo scenes. A repeated run fails immediately with an “already applied” error, without
altering the installed functions or data.

The browser mutation boundary is:

```sql
mutate_notebook_v2(p_trip_id uuid, p_operation text, p_payload jsonb) returns jsonb
trip_collaboration_status(p_trip_id uuid) returns jsonb
```

Every operation locks and verifies the named trip and requires owner/editor membership.
The owner-only editor-removal branch rechecks ownership. IDs are always selected or
written together with `trip_id`, so payload IDs cannot address another trip. Successful
writes return `{ "ok": true, "operation": "...", "id": "..." }`; the client treats this
as an acknowledgement and reloads the server snapshot rather than applying an optimistic
or local second write.

`CloudNotebookRepository` in `src/cloud/repository.ts` exposes typed methods for all UI
mutations. Photo objects are uploaded before metadata is inserted (with orphan cleanup on
failure), while metadata is deleted before the private Storage object. Each stamp has at
most one photo. New objects use versioned paths while the logical photo ID remains stable;
legacy `<trip>/<photo-id>.<ext>` objects remain readable. Replacement uploads a new path,
atomically replaces metadata under the same ID, then removes the old acknowledged object.
A failed metadata swap preserves the old row and removes the newly uploaded orphan.

## Cloud ZIP restore

`CloudNotebookRepository.restoreNotebook(data)` uploads every restored photo to a fresh
versioned private path, then calls the owner-only
`restore_notebook_v2(p_trip_id, p_payload)` RPC once. The RPC validates schema version,
IDs, references, group/stamp/expense relationships, photo paths, and rates before replacing
only that trip's content in one transaction. Membership and exact-email access are not
modified. Upload or RPC failure removes all successfully uploaded new objects.

After commit, old photo objects are removed using paths acknowledged by the transaction.
Storage deletion cannot participate in the PostgreSQL transaction: if that cleanup fails,
the restore remains committed and the repository returns `cleanupWarning` so an operator
can retry deleting those now-unreferenced private objects. If pre-commit cleanup itself
fails, the thrown error explicitly requires manual private Storage cleanup.

## Private photos

Private object names use an opaque version suffix:

```text
<trip_uuid>/<photo_id>-<version_uuid>.jpg|png|webp
```

Legacy `<trip_uuid>/<photo_id>.jpg|png|webp` paths remain valid. Photo IDs must match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`. Storage inserts require the
authenticated Storage owner, and photo metadata must match object path, owner, MIME type,
and byte size. Upload the object before inserting photo metadata. Delete photo metadata
before deleting the object. Editors retain these operations through membership RLS.

## Security checks

Use separate owner, editor/shared-email, and outsider accounts:

1. Outsiders cannot read or mutate another trip or its domain/Storage rows.
2. Editors can edit domain data but cannot add members, escalate role, share/revoke access, or delete the trip.
3. Unverified/mismatched emails and replayed/revoked claims cannot create membership.
4. Direct writes to `trip_email_access` and direct membership inserts fail.
5. A third member or second editor is rejected; the final owner cannot be removed or demoted.
6. Recorded expense rates remain immutable and only one expense can attach to an itinerary item.
7. Itinerary parent checks reject cross-trip/day parents, cycles, self-parenting, and grandchildren.
8. Referenced Storage objects cannot be mutated inconsistently or deleted before photo metadata.

Test with authenticated JWTs, not a SQL superuser or service role, because those bypass RLS.
