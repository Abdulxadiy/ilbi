# Notification inbox foundation — 2026-10-27

This increment provides the recipient-validated inbox parser, scoped provider and reusable real bell. It is the dependency for the subsequent core-screen and notification-route integration; it does not yet claim that the committed application shell exposes the whole feature.

The provider reads `/sales/notifications/`, uses server unread totals and the validated server cursor, rejects other recipients, scopes state to server/account/store, stops polling in the background, and handles read/read-all/delete/clear only after server acknowledgement. Notification targets are a typed internal allowlist, not arbitrary server-provided URLs. A separate explicitly synthetic preview handler supports browser QA.

Actual focused inbox checks: **12 tests passed**, strict owned-file lint and TypeScript passed in the notification slice. Tests cover recipient and count validation, pagination, scoped data/late responses, mutations and safe destinations. These are component/API-contract checks, not a real phone notification. Direct-FCM, route/preferences/shell integration, server migration and native delivery are recorded separately in `NOTIFICATION_READINESS_2026_10_27.md`.
