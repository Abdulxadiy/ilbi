# Support and workspace notification producers — 2026-10-27

Status: source implemented and tested. Native receipt and production rollout remain acceptance gates.

## Actual events and recipients

Support now creates a generic in-app `support_message` notification and its existing durable push outbox event for each **new** visitor/operator message in a conversation with a real, active tenant:

- An operator reply targets only the conversation's actual authenticated visitor, with current active store membership.
- A visitor message targets the assigned active platform operator. An unassigned conversation targets the active platform operators who can actually access the operator inbox. The sender is excluded; inactive, blocked demo and unaccepted accounts are excluded.
- The notification contains no chat text, subject, name, attachment, phone number or guest credential. Its only internal link identifies the conversation UUID. The existing FCM transport still emits its generic lockscreen title/body and recipient/tenant/notification IDs.
- Existing message `client_id` replay checks return the original message before this producer runs. Authenticated conversation creation now serializes concurrent copies per user before its replay lookup; the actual concurrency test produces one source conversation/message/notification/outbox event.
- Reading through the conversation's latest message marks that recipient's conversation alerts read. Reading an older partial cursor does not clear newer alerts. Claiming or closing a conversation suppresses stale operator broadcast alerts. The same source transaction owns these changes.

Support reads remain personal and available across the user's stores. The existing new-conversation UI already supplied its selected tenant explicitly. Session writes now consistently supply that explicitly selected tenant only for authenticated visitor POSTs and reject an obsolete session epoch before sending. A legacy tenantless conversation can bind only when its visitor next sends a **new** message with an explicitly validated store; operator actions never guess the visitor's tenant. An already bound conversation is not moved or rebroadcast into a different store.

Guest/unscoped conversations continue using their private support/Telegram flow. They do not receive invented tenant-scoped device events. An authenticated visitor needs an actual store association and an opted-in native installation for this device channel.

Workspace now produces generic `workspace_assigned` and `workspace_due` alerts:

- A real assignment change targets the actual active assignee; assigning a reminder to oneself produces no assignment echo.
- A due reminder targets its active assignee, including legitimate self-created reminders. A nullable `due_notified_at` marker is written in the **same transaction** as its inbox/outbox event. Deleting a notification does not reset that marker or replay the due event.
- Completing, deleting, reassigning or rescheduling a reminder marks obsolete alerts read, suppressing their still-pending push deliveries. A true reschedule, reassignment or reopen resets the marker for the new due occurrence; a repeated unchanged patch does not.
- A bounded, indexed, skip-locked worker processes due reminders every 60 seconds via Celery beat. It excludes inactive/archived membership and blocked synthetic accounts before its batch limit. No worker recreates reminders or financial records.

The new kinds use the existing **system** device category; existing opt-out continues to apply. No new preference category or native dependency was introduced.

## Mobile navigation

Only an exact internal `/support?conversation=<UUID>` link maps to the existing Support route. The route validates the parameter, requests the actual protected support detail and drops the previous thread immediately when the parameter/account/store changes. External URLs, extra query parameters and malformed paths are rejected. Guests do not auto-open an authenticated notification parameter.

Workspace notices remain readable in the inbox. There is no invented workspace destination: a dedicated mobile workspace module is a separate audit item. The current notice carries no private task title; detailed task CRUD remains available through the existing web/desktop workspace.

## Verification

- **57 actual PostgreSQL backend tests passed** across notification delivery/registration, support API and workspace suites, including 12 new producer checks. These exercise recipient privacy, real API replay and tenant boundaries, transaction rollback, source read/completion suppression of already-pending push retries, two concurrent due workers, and concurrent authenticated support starts.
- **30 mobile tests passed across six suites**, including validated notification targets, direct/change/invalid support parameters, guest/account isolation, selected-store write headers, stale session rejection, and existing message cursor/identified retry behavior. Mobile HTTP responses are mocked; backend checks above use the actual ORM/API.
- Whole mobile TypeScript check and strict lint of changed mobile source/tests passed. Django migration drift check reported no changes detected; the backend CI fatal-error Ruff rules passed.

Evidence: [activity-notifications-2026-10-27](evidence/activity-notifications-2026-10-27/).

A first suppression assertion expected already-read events to become skipped deliveries. The dispatcher correctly avoids creating such deliveries at expansion time. The final regression instead injects a synthetic provider failure first, then reads/completes the real sources and verifies both persisted retries are skipped without sending. No external push provider was contacted.

## Deployment requirements

Apply core migration `0017_workspacereminder_due_notified_at` (including its pending-due partial index) and sales migration `0022_alter_notification_type`; restart the backend and Celery worker/beat with the tested source. FCM still requires the previously configured server credentials and explicit device opt-in. No production mutation, live device notification, emulator manipulation or release publication was performed by this slice.
