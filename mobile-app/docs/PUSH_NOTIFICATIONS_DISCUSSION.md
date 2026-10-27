# ILBI phone notifications — discussion, 2026-10-25

**Status update, 2026-10-27: implementation authorized and started.** See [the live readiness record](NOTIFICATION_READINESS_2026_10_27.md) for completed slices and actual acceptance gates. The catalogue below remains the planning inventory. The owner wants a notification system for the whole ILBI platform. Z reports, chat and B2B were examples, not the scope boundary. Android first; IPA/APNs later. This document does not claim the existing APK supports phone push.

## Permission and delivery

Android permission lets the OS display notifications. It does not register a device token, connect Firebase or send an ILBI server event. After developer-side integration is complete, the ordinary user mainly needs to grant permission and choose categories.

Proposed route: `committed ILBI event → delivery queue → Expo Push → FCM → Android`. Later, the same server layer can reach iPhone through APNs. Local scheduled notifications can work without a new server send, but cannot discover a new server report, incoming message or another shop's B2B action. Current support polling stops on blur/background.

Sources: [Android permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission), [Expo setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/).

## What already exists

- `backend/apps/sales/models/notification_model.py`: server inbox records for `daily_z_report`, B2B request/accepted/partially accepted/rejected/cancelled and other types. These are not native phone delivery.
- `backend/apps/cashbox/services/cashbox_service.py`: an owner notification when a final report is generated and the existing setting permits it. The scheduled Telegram summary in `cashbox/tasks.py` is distinct; an unclosed-shift summary must not be described as a finalized Z report.
- `sale_service.py` and `b2b_transfer_service.py`: B2B status notifications. Preserve their financial transactions/recipient rules.
- `sales/services/debt_service.py` and `debt_reminder_service.py`: owner inbox notifications for debt threshold crossings and due dates. `inventory/tasks.py` creates scheduled low-stock inbox alerts. These are additional existing producers, not future ideas.
- `backend/api/v1/sales/views/notification_views.py`: recipient/tenant-scoped inbox and read actions. The mobile inbox/bell remains DMP-060 work.
- `backend/apps/support/tasks.py`: configured Telegram operator alerts. Mobile support chat exists, but native phone delivery of incoming messages/operator replies still needs its own event path.
- No `expo-notifications`, phone-token registry or FCM/APNs credentials are configured. The APK signing key is separate from push-service credentials.

## Platform-wide event catalogue

This is the starting inventory for implementation planning, not a claim that every module already emits a phone-ready event. **Inbox** means an existing server notification producer was found; **domain only** means the business data/action exists but its proposed notification still needs implementation; **local** means the source may exist only on that device. All rows still lack native phone delivery. Inspect each service and its recipient permissions before implementing that slice.

| Area | Candidate events | Current source / gap | Proposed recipient and destination |
| --- | --- | --- | --- |
| Debts and payments | Due/overdue debt, threshold crossing; recorded payment or settlement if requested | **Inbox:** threshold and due-date services above. Payment/settlement alerts are additional proposed events. | Authorized owner/finance user → exact debtor and ledger. Do not message the customer merely because the shop tracks their debt. |
| Inventory shortage | Low-stock/deficit summary, out-of-stock transition | **Inbox:** scheduled `inventory/tasks.py` deficit reports. Immediate transitions/custom thresholds need their own policy; do not describe the existing fixed deficit rule as configurable. | Owner/authorized stock manager → filtered inventory. Group affected goods rather than send one alert per SKU. |
| Batches and expiry | Approaching expiry, expired stock with remaining quantity | **Domain only:** `inventory/models/batch_model.py` has `expires_on` and quantity. No expiry phone scheduler was found. | Authorized stock manager → affected batches. Deduplicate by batch/deadline and stop reminders after disposal or depletion. |
| Sales and returns | Important sale/return/void, exceptional discount or price change | Sale Telegram task and `core/models.py` audit actions exist; a phone event/threshold policy is proposed. An ordinary successful checkout is not automatically a push to its cashier. | Owner/authorized manager → sale or audit details. Routine sales default to a digest/opt-in stream. |
| Cashbox and reports | Final Z report, cash discrepancy, overdue shift closing, requested report ready/failed | **Inbox:** finalized Z-report producer. Cash discrepancy audit action exists. Additional shift/report-job events require implementation. | Existing authorized report recipient first; manager/cashbox permissions for other events → exact shift/report. A scheduled open-shift summary is not a finalized Z report. |
| B2B | Incoming request, accepted/partial/rejected/cancelled status; return/discrepancy actions that need attention | **Inbox:** existing B2B producers; enum presence alone does not prove every transition emits a notification. Audit each transition including returns. | Authorized sender/receiver users under existing rules → exact transfer/return. Never perform accounting from a notification button. |
| Store-to-store transfers | Incoming shipment, received delivery, discrepancy, returned goods | **Domain only:** `inventory/models/transfer_model.py` and `inventory/services/transfer_service.py`; separate from B2B sales. | Authorized source/destination staff → shipment and discrepancy review. Avoid duplicate B2B/transfer alerts for the same underlying action. |
| Support and chat | Incoming message/reply, assignment or conversation-state change when useful | `support/models.py`, `support/tasks.py` and mobile support exist; Telegram operator alerts are not phone push. | Conversation participant or assigned authorized operator → conversation. Inspect any additional business-chat module separately; do not invent one. |
| Tasks and reminders | New assignment, due/overdue task, changed deadline or completion when requested | **Domain only:** `core/models.py:WorkspaceReminder`, workspace API and web `components/workspace/Reminders.jsx`. | Assignee; creator only for useful updates → exact task. Local scheduling is optional and must reconcile edits/completion across devices. |
| Documents and signatures | Document shared/ready, signature requested/received/rejected, report/PDF generation failure | **Gap:** desktop signatures currently include local persistence; the audit DMP-066/067 does not establish a server signing workflow. | Explicit authorized document participants → protected document. Add authoritative server state first; do not pretend a local pen stroke emits a cross-device event. |
| Employees and access | Invitation, changed permissions, blocking/unblocking or membership removal | **Domain only:** account employee-management services and `AuditAction` entries. | Affected user and appropriate owner → team/access page. A removed membership must not receive further shop business content. |
| Account security | Relevant suspicious login, password/identity change, revoked session | **Domain only:** account login/password-reset services, desktop security and audit events. Reliable risk/new-device detection needs explicit design. | Account owner → account/security screen. No passwords, OTPs or session tokens in payloads; push alone cannot recover an inaccessible account. |
| Seller/store administration | Seller-profile review approved/rejected/expired, approaching profile expiry, ownership/store changes | **Domain only:** `tenants/seller_profile_service.py`, profile expiry and tenant/audit models. No complete phone event path. | Profile/store owner or assigned reviewer → correct admin/profile page, respecting platform-admin boundaries. |
| Synchronization and recovery | Work waiting too long, rejected command/conflict, failure requiring intervention, backup failure | **Local/domain:** desktop SyncCenter, sync journal and `desktop/ilbi/backups.cjs`; mobile parity/recovery gaps remain. A local offline failure cannot immediately reach a remote phone. | Local actionable status first. Authorized remote alert only after a server receives a trustworthy status; open the affected sync/recovery item and preserve pending work. |
| Application/service notices | New compatible version, important maintenance or incident | In-app desktop/mobile daily version reminders exist. Phone announcements/maintenance feed require a separate authoritative source and policy. | Affected install/account → official update or service-status page. Batch version notices; never send a daily phone push just because the daily in-app strip exists. |

Subscription, tariff or other future-module alerts can be added when those modules and their authoritative events exist. Do not invent active billing or an event producer to fill a category. Before implementation, also inspect shared web/desktop settings and the live parity ledger for additional actionable events; extend this catalogue with source evidence.

## Notification policy and user experience

The foundation must support additional modules without building a separate push system for each feature: a typed event catalogue declares its source, audience, category, urgency, safe text, target, grouping key and expiry. Delivery adapters handle inbox, Android/iOS push and existing optional Telegram separately. A category is not itself permission to receive every store's data.

- **Needs action:** incoming request, actionable discrepancy, relevant security change. Prompt phone alert where permitted; open the exact task/resource.
- **Reminder:** debt/task due, expiry approaching. Use the user's schedule, business timezone and repeat limits; cancel obsolete reminders after payment/completion.
- **Information:** routine sale, ordinary stock receipt, successful routine sync. Inbox or digest by default; instant push is opt-in. Do not turn every database change into a phone interruption.

Offer category controls across debts/payments, stock/expiry, sales/cashbox/reports, B2B/transfers, chat, tasks/documents, team/security and system notices. Include per-store preferences, quiet hours, sound and digest frequency where appropriate. Respect OS permission and channel settings; urgency does not authorize bypassing Do Not Disturb. Operators and owners can have different defaults because their responsibilities differ.

Initially follow the existing owner rule for reports. Chat goes to authorized participants, excluding the sender; avoid an OS alert while reading the same conversation. Suppress duplicate self-action confirmations across devices by a documented actor/audience policy, without suppressing a genuine task assigned to the actor. Repeated failures and low-stock goods should be grouped. Resolve/cancel expired events before dispatch, especially reminders and requests already handled elsewhere.

The sidebar should contain notification preferences and access to notification history, while the real bell/badge gives quick access from the app. Keep support as its existing dedicated sidebar screen; no floating corner chat launcher. Inbox read state and actual unread counts must come from the server. Delivery, OS display, opening and marking read are different states; arrival alone does not mark an item read.

Keep totals/private message bodies out of lock-screen previews by default. Retrieve reports/PDFs after authorization inside the app. Route using typed targets/resource IDs, not arbitrary notification URLs.

## Stages after the owner starts implementation

1. Add the SDK-compatible notification module/config plugin, Android channels and permission flow. Denial must not block ordinary app use or cause repeated prompts.
2. Configure Firebase for `uz.ilbi.mobile`, client `google-services.json`, FCM v1 sending credentials and the owner's real Expo project ID for Expo Push. Native builds can remain local; EAS cloud building is optional.
3. Register installation tokens through an authenticated endpoint. Bind account/membership on the server, handle rotation/multiple devices and deactivate old bindings on logout/account changes. Never trust a client-supplied recipient ID.
4. Introduce the shared event catalogue and reuse appropriate existing inbox events across reports, debts, stock and B2B. Add new producers in the module-specific slices above, with explicit chat/task/security and other approved rules. Keep phone delivery independent of Telegram configuration: existing Telegram tasks can return early when no bot/contact is configured. Commit durable delivery/outbox records with domain changes, then dispatch separately through Celery. Retrying a failed push must never repeat a sale, regenerate a financial report or redo B2B accounting. Do not indiscriminately push every audit row or add an extra inbox record for an event already represented.
5. Check provider tickets/receipts, deactivate `DeviceNotRegistered` tokens, back off transient failures and deduplicate by event ID. Provider acceptance is not proof the person read the message.
6. Add the real mobile inbox/badge, preferences and foreground/background/cold-start target handling. Recheck current account/store/resource authorization on tap, including after login/store changes.
7. Rebuild Android with the established key, verify the APK, then test real delivery. Add iOS/APNs and IPA in the later agreed stage.

Deliver vertical slices after the shared foundation: inventory the current producers first, then complete each category's server event, audience/preferences, inbox/route, real phone delivery and recorded checks before the next category. The rollout order can prioritize actionable existing events; the finished scope must not silently shrink to Z reports, chat and B2B. Keep an event-by-event ledger showing source, permission policy, deduplication/cancellation rule, Android result and remaining iOS/server gates.

An offline desktop event can produce cloud push only after the server receives and commits its sync. Do not promise instant delivery from an offline source. Recheck active token bindings before dispatch; already-submitted pushes can race logout, so minimize payload content and reject stale-account taps.

The Firebase client configuration belongs in the native application. The private service-account key belongs only in the sending service/EAS credentials, outside APK assets and Git. [FCM v1 setup](https://docs.expo.dev/push-notifications/fcm-credentials/).

## Acceptance

- API/unit checks: wrong-account/store access, revoked membership, unauthorized registration, duplicates, permission denial, token rotation, logout, provider failures/receipts and safe routing. Include event rollback/no-push, durable retry, per-store preferences, quiet hours, stale task/debt cancellation and scheduler timezone boundaries.
- Android runtime: open, background and ordinarily closed; cold-start tap; permission deny/re-enable; category mute; real events for every delivered category using isolated accounts. Verify at least one existing event outside Z/chat/B2B (for example debt due or low stock), plus each new producer as it is added. Test grouping and a request resolved on another device. OS force-stop, battery restrictions or missing connectivity can delay/block delivery; do not promise unconditional instant background execution.
- Actual remote delivery needs a physical Android phone or emulator with Google Play services. Existing AOSP-only parity/release emulators do not establish FCM delivery. Use an expressly authorized test installation; no unsolicited pushes to operators/customers.
- No credentials or real delivery are configured by this proposal. Keep a missing external setup as an explicit gate; never replace delivery with a mock and call it passed.

Source: [Expo sending and receipts](https://docs.expo.dev/push-notifications/sending-notifications/). Update DMP-060 only after verified implementation. One test push does not complete iOS, all categories, their destination screens or production acceptance.
