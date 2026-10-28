> Historical prototype/review record. Current implementation status and verification limits are recorded in the [live parity audit ledger](DESKTOP_MOBILE_PARITY_AUDIT.md).

# ILBI Mobile — Defects

Updated 2026-10-24. The previous “no open defects” entry was unsupported. See [MOBILE_REVIEW.md](MOBILE_REVIEW.md) for reproduction context, corrections and evidence.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| MOB-001 | P1 | Failed checkout fabricated receipt and cleared cart | Fixed; checkout regression tests pass |
| MOB-002 | P1 | Failed debt request reduced local balance | Failure handling fixed; actual debt module remains gated/incomplete |
| MOB-003 | P1 | Refresh invalidated own retry; stale response could affect a new session | Fixed; client regression tests pass |
| MOB-004 | P1 | Draft not restored; cart could leak across user/store scopes | Fixed; persistence/isolation tests pass |
| MOB-005 | P1 | Legacy outbox lacks account isolation and safe replay | Mitigated: replay/enqueue/delete disabled; full implementation open |
| MOB-006 | P1 | Settings cache cleanup deleted financial queue | Fixed: only temporary cache keys removed |
| MOB-007 | P1 | Unknown financial result lacks reconciliation UI/operation journal | Open; persisted retry identity is a partial mitigation |
| MOB-008 | P1 | Real auth, store selection, permissions and API workflows unverified | Open |
| MOB-009 | P1 | Native Android/iOS flows have no execution evidence | Open; JS export passes only |
| MOB-010 | P2 | PDF failure reported success; receipt rendered fixed financial data | Misleading behavior fixed; actual QR/thermal/PDF/native sharing remains open |
| MOB-011 | P2 | Documents/signatures/inventory/reports use local prototypes | Open; gated in real mode |
| MOB-012 | P2 | Scanner controls do not scan; several controls and pagination unfinished | Open |
| MOB-013 | P2 | Native storage errors silently fell back to memory | Fallback removed; lifecycle/storage-failure native tests open |
| MOB-014 | P2 | Changing API server retained current tokens | Fixed: validate then sign out before runtime endpoint change |
| MOB-015 | P2 | Mixed-payment switch did not affect checkout | Mitigated: disabled and labeled unfinished |
| MOB-016 | P2 | SDK toolchain audit reports five high entries | Open; incompatible automatic downgrade not applied |
| MOB-017 | P3 | 57 lint warnings, template release icons, unfinished UX details | Open |

Do not mark an issue verified from screenshots or fixture arithmetic alone. Include the command/device, steps and observed result. A browser preview pass does not close a native release gate.
