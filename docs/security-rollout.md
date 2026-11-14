# Security rollout — draft

This branch is not ready to merge or deploy. It contains the first security fixes from the 2026-11-14 review, not the complete review scope.

## Included

- Remove organiser self-reservation aggregates and existing-account bearer reset links.
- Require 15-character new passwords, preserving login for existing accounts.
- Atomic permission changes and link replacement, fresh credentials checked when creating sessions.
- Bounded request reader, generic forgot-password recipient responses, safe digest grouping.
- Correct purchase status after buyer reassignment; theme changes preserve form input.
- Add email_verified with default 0: private scheduled emails are suppressed until mailbox reset proves ownership for an existing account. A managed-list handover does not verify its new mailbox.
- Eleven regression scenarios using Node SQLite, with mail stubbed; not a substitute for workerd integration tests.

## Merge blockers / remaining scope

- Dedicated email verification flow and resend controls; recovery for sole organiser without mail.
- Configuration and safe private-instance provisioning, replacement/removal of legacy bootstrap and deployment bindings preservation.
- Pinned local Cloudflare runtime and integration tests; validate migrations and session concurrency there.
- Move bearer secrets from API paths to request bodies; account-based login throttling and supported KDF upgrade plan.
- Digest delivery progress, retry/idempotency, notification preferences.
- Backup/restore rehearsal and data export/deletion.
- Frontend draft state, keyboard accessibility, module extraction and lazy demo.
- README, licensing provenance, asset/versioning and schema cleanup.

The preceding commit preserves the user's existing local changes, including fonts and branding. Their original working directory was not changed.
