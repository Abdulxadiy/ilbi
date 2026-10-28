# ILBI Mobile — Start Here

**Read this file first if you are the AI implementing the ILBI mobile app.**

This is the entry point for the entire mobile-concepts directory. It explains what each folder contains, which decisions are current, where the detailed implementation instructions live, and how to begin work.

The documentation is in English for the implementation AI. The app's default interface is Uzbek, Latin script.

**Implementation now exists in [`../../mobile-app/`](../../mobile-app/).** Start with its [development guide](../../mobile-app/README.md), [current review](../../mobile-app/docs/MOBILE_REVIEW.md), and [verified progress](../../mobile-app/docs/MOBILE_PROGRESS.md). The source is a partial prototype; old “all phases passed” claims were unsupported. Use the Docker phone preview for browser interaction checks and keep native Android/iOS acceptance separate.

## 1. What this work is

Build an actual **React Native + TypeScript application for Android and iPhone**, connected to the existing ILBI Sales Platform.

The objective is a compact, understandable, fast mobile workflow with accurate business data. The reference pictures explain the desired design; they are not functioning app screens or proof that the native app has been implemented.

This README is a map and a starting guide. The **[Master Implementation Prompt](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md)** contains the detailed requirements, acceptance gates, test scenarios, and delivery conditions. Follow it for implementation.

## 2. Directory map and design history

| Location | What is inside | How to use it |
| --- | --- | --- |
| **[README.md](./README.md)** | This starting guide and directory map. | Read first; return here when you need to find a resource. |
| **[v1/](./v1/)** | Initial alternatives: simple home, fast sales, dark mode, catalog, management, and animation storyboards; boards 01–06. | Historical exploration. The owner initially preferred 01 and 06, but later decisions refine and override their details. |
| **[v2/](./v2/)** | Expanded navigation, sidebar, product/price explorations, customer selling-price clarification, and receipt flows; boards 07–15. | Useful history for understanding the workflow. Some early catalog-price screens do not represent the later request to edit a customer's current sale price. |
| **[v3/](./v3/)** | Established desktop-inspired monochrome direction, compact carts, customer selling price, documents, signatures, receipts, and sidebar; boards 16–21. | The approved design foundation. Keep its principles, while using the latest detailed states in v4. |
| **[v4/](./v4/)** | Latest six design boards covering 18 mobile states, original logo references, and the detailed English implementation prompt. | Primary visual and implementation handoff for new work. |
| **[v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md)** | Full product specification, native behavior, API guidance, phases 0–12, tests, defect handling, and evidence requirements. | Main implementation contract; open after this README. |
| **prompts.json inside each version** | Image-generation prompts, reference information, and available design-history metadata. | Provenance and design context. These are image-generation prompts, not a replacement for the implementation contract. |

Existing ZIP files in the older folders are historical artifacts. Work from the ordinary Markdown, PNG, SVG, and source files. Do not generate more ZIP archives as routine progress deliverables.

### Which reference wins?

Use the owner's latest explicit instructions and current backend constraints first. Then follow the written master prompt and the latest v4 references. Use v3 for established design context, and v1/v2 only for history.

Do not combine incompatible old alternatives into a new design. In particular:

- Older blue primary buttons do not override the current black/warm-white interface.
- Older plain uppercase ILBI text does not replace the authentic logo.
- Older photo-free cart alternatives do not override the retained small product thumbnails.
- Early global product-price editors do not redefine customer-specific cart price editing.
- Static animation storyboards do not prove that an animation is implemented or smooth.

## 3. Read in this order

1. **This README:** understand the folder map, current direction, and work sequence.
2. **[Master prompt, Sections 1–2](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#1-read-first-execution-contract):** read the execution contract, project context, source precedence, and known boundaries.
3. **[Master prompt, Section 3](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#3-visual-references-all-18-screen-states):** actually open all six current boards and the real logo.
4. **[Master prompt, Sections 4–5](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#4-design-system-and-interaction-rules):** understand layout, theme, navigation, and interaction rules.
5. **[Master prompt, Section 10](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#10-mandatory-phased-implementation-plan):** identify Phase 0 and its acceptance gate.
6. **[Master prompt, Section 12](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#12-evidence-defect-handling-and-progress-files):** establish progress, bug, and evidence records.
7. Inspect the current repository and execute Phase 0. Read the relevant feature/data/test sections before implementing each later slice.

For a limited-context AI, use this document as an index. Work through one small verified behavior at a time; do not try to keep every version and the entire codebase in context at once. Record decisions and progress so that resuming does not erase earlier requirements.

## 4. Current design decisions

These decisions summarize the direction; exact behavior and acceptance criteria remain in the master prompt.

| Area | Required direction |
| --- | --- |
| Platforms | Actual native React Native screens on Android and iOS. |
| Mobile layout | Adapt the workflows for touch; do not shrink the desktop layout or wrap the entire website in a WebView. |
| Colors | Warm-white/light and graphite/dark themes inspired by the desktop. Blue remains in the actual logo; primary controls are monochrome. |
| Logo | Use the real ILBI mark and lowercase ilbi.uz wordmark, with the recognizable blue ribbon. |
| Cart | Compact flat rows with tiny 24–28-point product thumbnails, readable prices, and aligned totals. |
| Selling price | Make the actual per-unit price clearly visible and editable directly from a cart row. |
| Price scope | A negotiated price affects only the current sale line; do not silently update the global catalog or cost price. |
| Navigation | Keep both the left drawer and the five bottom items: Bosh, Tovar, Savdo, Qarz, Menyu. |
| Menyu | Open the same left drawer as the header hamburger; do not create an empty extra page. |
| Primary actions | Remain reachable above the bottom navigation and clear of the keyboard. |
| Documents | Real list/viewer, A4 content, drawn-signature capture, persistence, and correct export. |
| Receipts | Preserve actual historical prices, totals, logo, and permitted QR/public link. |
| Sharing | Distinct working actions for PDF export, public-link copying, native sharing, and supported printing. |
| Dark documents | Keep paper white with dark text inside the dark app shell. |
| Offline | Show truthful cached/draft/pending/confirmed states; safe durable financial replay must be implemented and tested before it is enabled. |
| Quality | Correctness and usability first; restrained motion, readable text, no decorative clutter or false success. |

### Price example that must remain clear

~~~text
Catalog default for Sut 1 L: 12 000 per unit
Initial current sale:       2 × 12 000 = 24 000
Initial whole cart:         161 000

Customer-specific edit:     11 500 per unit
Updated current sale:       2 × 11 500 = 23 000
Updated whole cart:         160 000

Catalog default after edit: still 12 000
~~~

Use the full canonical fixture and validation cases in **[master prompt Section 11](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#11-test-scenarios-and-reference-data)**.

## 5. Current visual map: where to find each screen

Each linked PNG contains three phone states. A, B, and C identify those states.

| Board | States | What to implement |
| --- | --- | --- |
| **[22 — Cart and selling price](./v4/22-savat-va-sotuv-narxi.png)** | 22A compact light cart; 22B price-entry sheet; 22C updated dark cart. | Small thumbnails, clear editable unit price, correct recalculation. |
| **[23 — Customer and payment](./v4/23-mijoz-va-tolov.png)** | 23A customer selection; 23B payment/change; 23C sale completion. | Actual customer data, validated payment, truthful completion and next actions. |
| **[24 — Home and left drawer](./v4/24-bosh-sahifa-va-sidebar.png)** | 24A light home; 24B dark home; 24C open left drawer. | Shared navigation, store context, both themes, persistent quick access. |
| **[25 — Documents and signing](./v4/25-hujjat-va-imzolash.png)** | 25A document list; 25B A4 viewer; 25C drawn-signature canvas. | Document retrieval, readable preview, signature placement and persistence. |
| **[26 — Receipt, PDF, and sharing](./v4/26-chek-pdf-va-ulashish.png)** | 26A receipt viewer; 26B share choices; 26C exported PDF. | Actual files and permitted public links, real open/share/print behavior. |
| **[27 — Debts, offline, empty cart](./v4/27-qarz-offline-va-bosh-savat.png)** | 27A debts; 27B offline/pending cart; 27C empty cart. | Correct balances, honest synchronization states, useful empty-state actions. |

### Brand files

- **[Full vector logo](./v4/ilbi-logo.svg):** reusable original identity.
- **[Vector mark](./v4/ilbi-mark.svg):** compact symbol.
- **[PNG logo reference](./v4/ilbi-logo-reference.png):** visual identity check.
- Original app branding also lives in **[frontend/ilbi/public/brand/](../../frontend/ilbi/public/brand/)**.

Phone frames and the surrounding board titles are presentation material. Do not implement them inside the app. If an image contains an incidental generated-text/color/number artifact, follow the written requirements and verified data.

## 6. Where implementation and existing behavior belong

All paths in the following table point to the repository, not to a new independent backend.

| Need | Starting point |
| --- | --- |
| Existing product and development context | [Repository README](../../README.md). |
| Existing API usage and tenant/auth handling | [Web API client](../../frontend/ilbi/src/api/client.js). |
| Authoritative routes and validation | [Backend API](../../ilbi/api/v1/), including current URL and serializer files. |
| Existing checkout behavior | [POS screen](../../frontend/ilbi/src/pages/POS.jsx). |
| Existing receipt content | [ReceiptSlip](../../frontend/ilbi/src/components/common/ReceiptSlip.jsx). |
| Existing invoice/signature behavior | [InvoiceA4Modal](../../frontend/ilbi/src/components/common/InvoiceA4Modal.jsx). |
| Current share actions | [ShareDocumentButton](../../frontend/ilbi/src/components/common/ShareDocumentButton.jsx). |
| Public receipt link/document rules | [documentShare](../../frontend/ilbi/src/utils/documentShare.js). |
| Retry identity for financial requests | [requestKey](../../frontend/ilbi/src/utils/requestKey.js). |
| Existing business workflow guidance | [Role-specific guides](../../docs/qollanmalar/). |

If no native project exists, the default new application location is **mobile/ilbi/** at the repository root. If one already exists, extend it after inspecting its conventions.

Keep real app code in the native project. Keep these design/handoff documents and source reference pictures in **branding/mobile-concepts/**. Do not turn the branding folder into the application source tree.

Backend, web, and desktop code are sources of business behavior, not native UI components to copy blindly. Discover the current API origin and contracts. Do not assume desktop-only bridges, local browser storage, or DOM-based export code work on a phone.

## 7. Implementation steps and acceptance gates

The detailed instructions and checks are in **[master prompt Section 10](./v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md#10-mandatory-phased-implementation-plan)**. Use the same phase numbers in progress records.

| Phase | Deliverable | Before advancing |
| --- | --- | --- |
| 0 | Repository/API/image/tooling discovery and acceptance map. | Establish actual contracts, safe test data, native execution availability, and blockers. |
| 1 | Native foundation, authentic branding, shared components, and themes. | Build/install/run; verify safe areas, readable controls, and theme persistence. |
| 2 | Authentication, store context, drawer, and bottom navigation. | Verify actual auth and account/store isolation; exercise navigation and Back behavior. |
| 3 | Real home/catalog/search and scanner. | Verify actual results, pagination, scan handling, permission fallback, and camera cleanup. |
| 4 | Compact cart, selling-price editor, quantity editing, and empty state. | Verify canonical totals, cancel/apply, unchanged catalog price, keyboard layout, and draft restore. |
| 5 | Customer flows and online checkout. | Verify actual submission, validation, safe retries, duplicate prevention, and recoverable rejection. |
| 6 | Sales/history/receipts, PDF, links, and native sharing. | Inspect real files, historical values, QR, paper dimensions, native actions, and cancellation. |
| 7 | Documents, A4 viewer, drawn signatures, and signed export. | Reopen saved content, inspect exported signatures/pages, and verify correct storage isolation. |
| 8 | Debts and debt payments. | Verify balances, due states, actual payment effects, permissions, and duplicate prevention. |
| 9 | Required inventory, reports, settings, and other drawer workflows. | Every enabled destination must perform its real supported function. |
| 10 | Durable offline persistence and safe synchronization. | Test process death, restart, reconnect, lost acknowledgements, conflicts, and account isolation. |
| 11 | Cross-platform visual, accessibility, animation, and performance acceptance. | Review all 18 states and real native behavior on each tested platform. |
| 12 | Final regression, reproducible builds, artifacts, and handover. | Deliver evidence and accurate Android/iOS/capability status; no concealed failed gates. |

### The work loop is mandatory

~~~text
Read → define checks → implement a small slice → run → interact
     → inspect → fix defects → rerun checks → save evidence
     → pass this gate → continue to the next dependent slice
~~~

- Do not build all screens first and defer every test until the end.
- Do not stop at a plan or a set of hard-coded UI screens.
- Do not turn a failure into success by removing a business/security restriction.
- Do not claim a native platform passed because a web preview looks correct.
- After a gate passes, continue ordinary authorized work without asking for approval again.
- If a prerequisite is missing, record the exact blocked capability. Continue truly independent verified work; do not silently pass the blocked dependency.
- Track phase, platform, and capability separately. Android progress does not prove iOS acceptance, and an unavailable iOS runner need not prevent independent Android work.

## 8. First actions for the implementation AI

Do these before feature coding:

1. Read applicable repository instructions and inspect the current Git state. Preserve unrelated work.
2. Read the master prompt's execution contract and project context.
3. Open all six v4 boards and the actual logo assets.
4. Locate an existing native project, or establish the default mobile project location.
5. Inspect the relevant backend routes, request/response validation, auth, tenant permissions, and known production boundaries.
6. Identify available Android/iOS build and interaction tooling.
7. Set up isolated synthetic test accounts/data; do not test financial writes against production customers.
8. Create the progress, defect, API-map, decision, and evidence records.
9. Complete Phase 0's checks, then begin the smallest Phase 1 slice.

Do not begin by generating more design images, extracting old ZIPs, rewriting the backend, or copying screenshots into a fake mobile UI.

### Records to maintain

Inside the actual native project, use the following default documentation locations:

~~~text
mobile/ilbi/docs/MOBILE_PROGRESS.md
mobile/ilbi/docs/MOBILE_BUGS.md
mobile/ilbi/docs/MOBILE_API_MAP.md
mobile/ilbi/docs/MOBILE_DECISIONS.md
mobile/ilbi/docs/evidence/
~~~

These are future implementation records, not files guaranteed to exist already. Adapt their location if extending an existing native project.

Record the current phase/gate, actual commands and results, tested device/build, evidence, open defects, blockers, and next smallest action. Resume from these records and the current diff instead of starting over.

## 9. Copy-paste kickoff instruction

Give the implementation AI repository access and the images, then use this:

> Start with **branding/mobile-concepts/README.md**. It is the index for this mobile project. Then read the execution contract and project context in **branding/mobile-concepts/v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md**, inspect the six v4 boards and real logo, and execute Phase 0. Follow the current compact monochrome React Native/TypeScript direction for Android and iOS. Implement real API-backed native behavior in small vertical slices. After each slice, run it, interact with it, inspect logs/data/screens, fix defects, rerun the relevant checks, and save evidence. Advance only when that dependency gate passes. Track Android, iOS, and unavailable capabilities honestly. Preserve unrelated changes and existing backend restrictions. Do not stop at planning or mock screens. Begin with discovery and then continue the authorized implementation work.

The kickoff does not replace the master prompt. It tells the AI which file to read first and how to use the rest of the material.

## 10. Sharing this handoff and maintaining it

- For implementation in this repository, start from this README and keep relative links intact.
- If transferring the design handoff, preserve the **mobile-concepts/** directory structure and include **v4/** with its master prompt, six PNG boards, and logo assets.
- A Markdown file copied alone does not carry its linked image binaries. An AI without the pictures must not claim it has visually inspected them.
- Full integration also needs repository/API access or the corresponding verified contracts. Images alone are insufficient.
- Keep v1–v3 as history; do not delete or reinterpret them as newer decisions.
- If a future version becomes the current direction, update this README's primary links and explain what supersedes the older version.
- Keep this file as the stable starting point; keep the detailed implementation contract and the progress evidence clearly identified.

**Start here → read the master contract → inspect the references → verify the project → implement and test Phase 0 onward.**
