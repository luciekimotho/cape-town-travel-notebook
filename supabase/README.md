# Supabase foundation

The complete fresh cloud schema is provided as one Dashboard-ready setup migration:

| Migration | Contents |
| --- | --- |
| `0001_setup.sql` | Core domain schema and integrity; profiles and two-person exact-email sharing; RLS/grants; list/load and Cape Town bootstrap RPCs; private photo Storage |

Apply `migrations/0001_setup.sql` through the normal migration runner (for example,
`supabase db push`) after confirming the target Supabase project. No remote migration has
been applied, so this file establishes fresh history rather than replacing deployed history.

For Dashboard-only setup:

1. Open **SQL Editor → New query**, review the target project, paste the complete contents of `migrations/0001_setup.sql`, and run it once.
2. Configure the Authentication Site URL and Redirect URLs for the deployed and local app.
3. Keep passwordless email sign-in enabled.
4. Verify the `trip-photos` Storage bucket exists and is private.
5. Test owner, editor, exact-email claim, and outsider behavior with ordinary authenticated users.

Never put a `service_role` key in frontend code. Clients use the anon key with an
authenticated session; RLS remains the authorization boundary.

## Fresh Cape Town data

After the intended owner signs in, call:

```sql
create_capetown_2026_trip() returns uuid
```

The authenticated, security-definer RPC atomically creates the Cape Town trip for
21–28 September 2026, owner membership, eight dated itinerary days, readable fixed-ID
places/items, checklist, metadata marker, and one active exchange-rate set. It returns the
same trip UUID on retries for that owner by using the stable `capetown-2026-v1` marker and
an owner-scoped transaction lock.

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

## Private photos

The only valid private object name is:

```text
<trip_uuid>/<photo_id>.jpg|png|webp
```

Photo IDs must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$`. Storage inserts require the
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
