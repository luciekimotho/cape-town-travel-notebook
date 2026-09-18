# iPhone Home Screen sign-in

Safari and an installed Home Screen app can keep separate sessions. Finish
verification inside the notebook instead of expecting a link opened in Mail/Safari
to authenticate the installed app.

## Use the existing email template

1. Open the notebook from the Home Screen and request a sign-in email.
2. In Mail, press and hold the **original, unopened** sign-in link and copy it.
3. Return to the notebook. Choose **My email only has a sign-in link**.
4. Paste the link and choose **Sign in here**.

The notebook validates the project URL and verification type, then verifies the
token hash with its own Supabase client. It does not navigate to the link or follow
its redirect. Already-used links, browser address-bar URLs, recovery links, and
tracked/wrapped URLs are not supported. Never share a code or sign-in link.

If iOS reloads the app while viewing email, enter the same email address and choose
**I already have a code or link**, avoiding another email request.

## Recommended: show a numeric code in the email

In Supabase **Authentication → Email Templates**, update both **Magic Link** and
**Confirm signup** with `templates/magic-link.html`. Preserve `{{ .Token }}` and
`{{ .ConfirmationURL }}`.

This is a Dashboard template setting, not a SQL migration. The app cannot change
it with its public key. The copied-link flow works before this setting is changed.
Once the code is included, enter it directly into the notebook's **Email code**
field. Supabase persists and refreshes the session in that app/browser context.

Email quota limits still apply. This change does not bypass them or configure SMTP.
No code or link is written to logs, application URLs, or separate app storage.

## Real-device acceptance

Desktop automated checks do not establish iPhone compatibility.

1. Request and verify an email inside the installed PWA as described above.
2. Confirm the existing itinerary loads without creating a new trip.
3. Close and reopen the installed app; confirm it stays signed in.
4. Repeat after token refresh. Verify expired codes fail visibly and a fresh code
   works. Verify both numeric codes and copied unopened links.
5. Confirm regular Safari/desktop browser login still works independently.
