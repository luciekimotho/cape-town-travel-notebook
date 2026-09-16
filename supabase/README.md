# Supabase foundation

`migrations/0001_initial.sql` defines the collaborative PostgreSQL schema, RLS, invitation/import RPCs, and the private `trip-photos` bucket policies.

## Apply safely

Do **not** apply this migration until the Supabase project/ref has been explicitly confirmed. Then use the normal migration runner (for example, `supabase db push`) from a trusted operator environment. Never put a `service_role` key in frontend code; clients use the anon key plus an authenticated user session, and RLS remains the authorization boundary.

For a Dashboard-only setup:

1. Open **SQL Editor → New query**, paste the complete contents of `migrations/0001_initial.sql`, review the target project name, and run it once.
2. Open **Authentication → URL Configuration**. Set the Site URL to `https://luciekimotho.github.io/cape-town-travel-notebook/` and add both that URL and `http://127.0.0.1:5173/cape-town-travel-notebook/` as Redirect URLs.
3. Open **Authentication → Providers → Email** and keep email sign-in enabled. The current client uses passwordless email links.
4. Open **Storage** and verify `trip-photos` exists and is **private**. The migration creates its MIME/size restrictions and RLS policies; do not make it public.
5. Before real data is imported, test the owner/editor/outsider cases below with disposable accounts and records. Do not test with a service-role key because it bypasses RLS.

The SQL Editor run is the next required operator action. A publishable frontend key cannot create tables, policies, functions, or the private bucket.

The only valid private object name is:

```text
<trip_uuid>/<photo_id>.jpg|png|webp
```

Domain IDs are stored as `text` and imports preserve every ID byte-for-byte, including fixed IDs such as `dated-item-*` and `seed-place-*`. Relationships use the same unmodified IDs with trip-scoped composite foreign keys. Photo IDs must additionally match `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`; slashes, empty IDs, and traversal segments are rejected. The extension must match the eventual `photos.mime_type`. Storage inserts require the authenticated Storage `owner_id`; finalization attributes matching photo metadata to that same user. Storage object metadata must report the same MIME type and byte size as the photo row/import payload.

Upload the object first, then insert its photo metadata row. To delete, reverse the order:
delete the photo metadata row first, then delete the private Storage object. Storage deletion
is rejected while any `photos` row references the object. Editors retain both operations
through membership RLS; overwriting an existing object must preserve its path, owner, MIME,
and byte size unless the photo metadata is removed first.

## Invitations and two-step imports

- Call `create_trip_invitation(trip_id, email, role, expires_at)` as an owner. It returns the raw token exactly once; only its SHA-256 digest is stored.
- Call `revoke_trip_invitation(invitation_id)` as an owner to invalidate an unused token without deleting its audit row.
- Call `accept_trip_invitation(token)` while signed in as the invited, email-matching user. Tokens are expiring, single-use, revocable, and row-locked during acceptance.
- Invitation creation and acceptance both reject users who are already trip members; an existing membership is never silently reused or role-changed by consuming a token.
- Generate one random UUID `batch_id`, then call `begin_notebook_import(import_batch_id => batch_id, destination => destination)`. The same authenticated user/batch/destination always returns the same pending `trip_id` and owner membership.
- Set top-level `notebook.trip_id` to that returned UUID. Upload each private photo to `<trip_id>/<photo_id>.<ext>`. Existing-object responses are safe to treat as success on upload retries. All domain IDs—including non-UUID seed and dated IDs—must be sent unchanged and are stored unchanged.
- The finalize payload uses top-level `schema_version`, `trip_id`, `trip`, `checklist`, `days`, `places`, `activity_templates`, `itinerary_items`, `expenses`, `stamps`, `photos`, `rate_sets`, and optional `metadata`. Entity fields retain the v4 camel-case names. Each photo includes its exact `storagePath`.
- Call `import_notebook_v4(batch_id, notebook)`. It locks and validates the owner’s pending batch, verifies every declared photo object, inserts all domain rows in one transaction, and only then marks the trip and batch complete. A failed call leaves the trip pending and invisible with no domain-row commit. An exact retry of a completed batch returns the completed trip; changed payload reuse fails.
- Normal clients list with `list_notebook_trips()` and load with `load_notebook_v4(trip_id)`. Both these RPCs—and direct trip RLS—exclude pending imports. Do not build normal lists from `trip_members` or `import_batches`.

`list_notebook_trips()` returns completed caller memberships as:

```text
{ id: uuid, destination: text, role: "owner" | "editor", updated_at: timestamptz }
```

`load_notebook_v4(p_trip_id uuid) returns jsonb` returns `NULL` unless the caller is a
member of a completed trip. Its response is the camel-case application domain shape:

```text
{
  schemaVersion: 4,
  trip: { id, destination, travellers, startDate, endDate, timezone, notes, updatedAt },
  checklist: [{ id, title, category, dueDate?, completed, note?, createdAt, updatedAt }],
  days: [{ id, date, outOfRange }],
  items: [{ id, dayId, placeId, parentId?, templateId?, isActivityGroup,
            time?, notes?, bookingStatus?, visited, position, createdAt, updatedAt }],
  places: [{ id, name, address?, notes?, googleMapsUrl?, wantToVisit, seeded,
             createdAt, updatedAt }],
  activityTemplates: [{ id, name, description, stops: [{
    id, placeName, placeId?, notes, approximateMinutes?, optional
  }], seeded, createdAt, updatedAt }],
  expenses: [{ id, amount, currency, date, category, note?, rateSetId?,
               itineraryItemId?, createdAt, updatedAt }],
  stamps: [{ id, itineraryItemId?, placeName, visitDate, detached, createdAt }],
  photos: [{ id, stampId, caption, mimeType, width, height, size, createdAt, updatedAt }],
  rateSets: [{ id, label, effectiveDate, kesPerKes, kesPerUsd, kesPerZar,
               active, example, createdAt }],
  metadata: [{ key, value }]
}
```

Photo responses intentionally contain metadata only. Fetch blobs separately from the
private `trip-photos` bucket using the authenticated Storage client.

Exact import RPC signatures:

```sql
begin_notebook_import(import_batch_id uuid, destination text) returns uuid
import_notebook_v4(import_batch_id uuid, notebook jsonb) returns uuid
```

The finalize JSON contract is:

```text
{
  schema_version: 4,
  trip_id: <UUID returned by begin>,
  trip: <v4 trip with camel-case fields>,
  checklist: [...],
  days: [...],
  places: [...],
  activity_templates: [...with nested stops...],
  itinerary_items: [...],
  expenses: [...],
  stamps: [...],
  photos: [...with storagePath...],
  rate_sets: [...],
  metadata: [...]
}
```

## Security checks

Use separate authenticated owner, editor, invited, and outsider users against a disposable local/test project:

1. **Outsider isolation:** direct `select`, `insert`, `update`, and `delete` for another trip and its child rows must return no rows or an RLS error.
2. **Editor escalation:** an editor may edit itinerary/domain data, but attempts to insert a membership, change their role to owner, delete members, create invitations, begin/finalize an import, or delete the trip must fail.
3. **Invitation arbitrary join:** a non-matching email, expired/revoked token, invented token, and second token use must all fail; direct inserts into `trip_members` and `invitations` must fail. Confirm the last owner cannot be removed or demoted.
4. **Storage denial and integrity:** outsiders cannot list/read/write/delete objects. Reject wrong buckets, malformed paths/extensions, mismatched uploaders, MIME/byte-size mismatches, and cross-trip IDs. A pending owner can upload but the trip remains absent from list/load; a member can read an exact object and only its Storage owner can overwrite it. Confirm referenced object deletion fails, then succeeds after deleting its photo metadata.
5. **Import visibility/atomicity:** before finalization, list/load must return no pending trip and ordinary domain writes must fail. Force a bad final payload and confirm no domain rows commit. Retry begin/finalize and confirm the same trip is returned. A different user reusing the batch ID must fail.
6. **Expense integrity:** changing any recorded-rate field after insert and attaching a second expense to one itinerary item must fail.
7. **Grouping integrity:** cross-trip/cross-day parents, self-parenting, cycles, and grandchildren must fail.
8. **Protected trip state:** owner and editor direct updates to `status` or `import_batch_id` must fail; only the server-owned import RPC can transition a pending trip.
9. **Owner serialization:** concurrently demoting/deleting two owners must leave one owner; one transaction must fail rather than committing a write-skew.

Test with ordinary authenticated JWTs—not SQL superusers or the service role, which bypass RLS.
