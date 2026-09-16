# Supabase setup

The complete cloud setup uses two Dashboard-ready SQL files:

| Migration | Contents |
| --- | --- |
| `0001_setup.sql` | Core domain schema and integrity; profiles and two-person exact-email sharing; RLS/grants; list/load and Cape Town bootstrap RPCs; private photo Storage |
| `0002_cloud_app.sql` | Additive grouped bootstrap, transactional app mutations, collaboration controls, safe photo replacement, and owner-only validated ZIP restore |

Apply `migrations/0001_setup.sql` through the normal migration runner (for example,
`supabase db push`) after confirming the target Supabase project. Then apply
`migrations/0002_cloud_app.sql`. The second file is deliberately additive because
`0001_setup.sql` may already be installed.

For Dashboard-only setup:

1. Open **SQL Editor → New query**, review the target project, paste the complete contents of `migrations/0001_setup.sql`, and run it once.
2. Open another new query, paste `migrations/0002_cloud_app.sql`, and run it once.
3. Configure the Authentication Site URL and Redirect URLs for the deployed and local app.
4. Keep passwordless email sign-in enabled.
5. Verify the `trip-photos` Storage bucket exists and is private.
6. Test owner, editor, exact-email claim, and outsider behavior with ordinary authenticated users.

Never put a `service_role` key in frontend code. Clients use the anon key with an
authenticated session; RLS remains the authorization boundary.

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
load_notebook_v4(p_trip_id uuid) returns jsonb
```

`list_notebook_trips()` returns caller memberships as:

```text
{ id: uuid, destination: text, role: "owner" | "editor", updated_at: timestamptz }
```

`load_notebook_v4` returns `NULL` unless the caller is a member. Its response uses the
application's camel-case v4 domain shape and includes trip, checklist, days, items, places,
activity templates, expenses, stamps, photo metadata, rate sets, and notebook metadata.

## Mutations

The browser mutation boundary is:

```sql
mutate_notebook_v1(p_trip_id uuid, p_operation text, p_payload jsonb) returns jsonb
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
`restore_notebook_v1(p_trip_id, p_payload)` RPC once. The RPC validates schema version,
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
