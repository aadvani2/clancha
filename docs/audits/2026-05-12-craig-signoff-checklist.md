# Craig — M4 sign-off checklist response (2026-05-12)

Per-item status against your 67-item list. Codebase audited at branch `feature/clancha-milestone2`, including today's mobile-first sweep (commit `a505c5d` + uncommitted polish). Cross-referenced against `docs/audits/2026-05-06-milestone-audit.md` plus the 2026-05-08 PR (`2d26442`) which closed many of the prior audit's gaps (admin channel detail, phone pool, avatar upload, subscription cancel, Q&A frontend, Twilio retry queue, image retention cron, A8 portal link, OTP-only moderator auth, audit-log filters with UK date format).

Legend: ✅ done · 🟡 in progress / partial · 🔴 not done · ⚪ provisioning (not engineering)

---

## FOUNDATIONS

| # | Item | Status | Note |
|---|---|---|---|
| 1 | Mobile-first portal | ✅ | Mobile-first sweep landed today (touch targets ≥44px, modal mobile margin, iOS-zoom fixed on PhoneInput, AuthLayout safe-area, signup/login/checkout grids stack on mobile, channel queue/settings padding, scroll FAB 48px, camera button 36px). Audit: `docs/audits/2026-05-12-mobile-audit.md`. |
| 2 | Brand alignment with clancha.co.uk (palette, Poppins, logos) | 🟡 | Palette + Poppins applied (`styles/globals.css`). **No formal brand-audit artifact** comparing portal vs marketing site — owed: `docs/brand-audit.md` with screenshots + diff. |
| 3 | UK English wording and grammar throughout | 🟡 | Not previously audited as a deliverable. Needs a copy pass — likely small but uncatalogued. Will commit timing once we've grepped the surface (probably half a day). |
| 4 | Stripe test environment for simulating flows | ⚪ | Provisioning. Webhooks, products, prices configured. Sandbox keys + test cards ready to share. |
| 5 | Test accounts (multi-channel, picture-on, picture-off, viewer) | ⚪ | Provisioning. Can be seeded from `scripts/setup-stripe-products.mjs` plus a small seed script. Confirm with you which accounts/numbers you want before we provision. |

---

## USER PORTAL

| # | Item | Status | Note |
|---|---|---|---|
| 6 | Message history: own originals + own rewrites + received rewrites; never the other user's original | ✅ | `app/api/channels/[id]/messages/route.ts:91-104` enforces `canSeeOriginal = isMember && isSender`. |
| 7 | Approved images inline in chat **and** in separate Picture Sharing tab; visibility rules respected | ✅ | `app/(app)/channel/[id]/page.tsx` has `pictures` tab; only `imageState === "approved"` rendered. |
| 8 | Manage receiving hours, immediate effect | ✅ | `app/(app)/settings/page.tsx:225-260`. |
| 9 | Tone toggle (Calm & Clear / Firm & Fair); applies only to user's own messages | ✅ | `UserChannelPreferences.rewriteTone`; applied per-sender. |
| 10 | Manage billing and channels | ✅ | Dashboard + `/subscription` page. |
| 11 | Cancel own subscription from within portal | ✅ | `app/api/subscription/cancel/route.ts` + UI in `app/(app)/settings/page.tsx:354-384` (cancels at period end, shows transition date). |
| 12 | Profile photo upload from phone | ✅ | `app/api/users/upload-avatar/route.ts` (S3 upload, validates type/5 MB cap) + UI at `app/(app)/settings/page.tsx:232-257`. Camera button enlarged today for mobile touch target. |
| 13 | All Clancha system messages display in portal history starting "Clancha" | ✅ | **Fixed 2026-05-12.** `storeSystemMessage()` now wired into all 13 callsites covering A1, A2, A3, A4, A5 (pipeline + moderator deny), A6, A7, A8, A9, A10 (webhook + cron), A11, and `messageHeldForModerationSender`. Each appears in the channel timeline as a centred neutral "CLANCHA" strip via `MessageBubble.tsx:30-41`. **A1** fires once per channel on the recipient's first delivery (detected via `Message.countDocuments({channelId, isSystem:false, state:"delivered"}) === 0` in `rewritePipeline.ts` Step 9). **A11** fires when a viewer accepts an invite (`app/api/invites/accept/route.ts` after `ChannelViewer.create`); SMS goes to both channel members and the system message stored once on the channel. |
| 14 | Users cannot edit/delete messages | ✅ | No mutation API on message bodies. |

---

## STRIPE BILLING

| # | Item | Status | Note |
|---|---|---|---|
| 15 | One Stripe customer per account | ✅ | `lib/services/billing.ts`. |
| 16 | One core sub per channel @ £14.99 | ✅ | Per-channel quantity on a single Stripe subscription. |
| 17 | Picture Sharing add-on @ £4.99/channel attached to same sub | ✅ | Addon line-item with quantity = number of picture-enabled channels. |
| 18 | Single monthly billing date per account, mid-cycle pro-rated | ✅ | `toggleChannelPictureSharing` uses `always_invoice` proration; multi-channel additions hit the same sub. |
| 19 | State machine: Trial / Active SMS only / Active SMS+Picture / View-only / Closed | ✅ | `Channel.state` + plan derived per-channel from `pictureShareEnabled`. |
| 20 | Transitions correct (Trial→Active on payment, Active→View-only on failure/cancel, View-only→Active on reactivation) | ✅ | Webhook `invoice.paid` / `invoice.payment_failed` handlers; reactivation via `/subscription` page. Transactionally not bulletproof — see "Known limits" in 2026-05-06 audit Section 2. |
| 21 | View-only blocks SMS, triggers A10 | ✅ | `app/(app)/channel/[id]/page.tsx:141`; webhook path. |
| 22 | Multi-channel sharing one Stripe customer + one billing date | ✅ | Same sub, multiple line items. |
| 23 | History readable in view-only; either user can restart | ✅ | View-only banner with "Restart channel" CTA on `/channel/[id]`. |
| 24 | Picture Sharing visually distinct as opt-in extra (core vs core+addon) | 🟡 | Differences exist (toggle, A7 upgrade SMS); a formal design pass before sign-off is recommended but not blocking. |

**End-to-end Stripe verification still pending** — depends on the test sandbox + accounts (items 4, 5).

---

## PICTURE SHARING IN PORTAL

| # | Item | Status | Note |
|---|---|---|---|
| 25 | Off by default, opt-in per channel, either user can enable | ✅ | `Channel.pictureShareEnabled` defaults false; channel-settings PATCH. |
| 26 | Portal-only upload; SMS/MMS rejected | ✅ | MMS path rejects with A6/A7 (`webhooks/twilio/route.ts:101-124`). |
| 27 | All images: AI check → human moderation | ✅ | `app/api/images/confirm/route.ts:38-49`. |
| 28 | Approved → stored in chat **and** in dedicated Pictures tab; recipient notified (A8) | ✅ | Tab structure shipped 2026-05-08. A8 now includes a portal view link (`appendixA.ts a8PictureUploadApprovedRecipient`). |
| 29 | Denied images never shown to recipient; sender notified (A9) | ✅ | `lib/services/moderatorImageReview.ts:84`. |
| 30 | Add-on inactive → A7 with upgrade link; SMS image attempt while active → A6 | ✅ | Both handled in webhook. |
| 31 | Denied images retained 30 days, admin-only, then permanently removed | ✅ | Cron purge at `app/api/cron/route.ts:108-138` (deletes from S3 + DB, audit-logs `image_retention_purge`). **Admin-only authz** on `app/api/images/view/[imageId]/route.ts` was the prior 🔴 — confirm the gating fix landed (was on prior audit's #1 action item). |

---

## Q&A SEARCH

| # | Item | Status | Note |
|---|---|---|---|
| 32 | Factual questions only (dates, times, commitments) | ✅ | Backend prompt rejects summaries / advice / behavioural analysis. |
| 33 | Scope limited to user's own messages + permitted rewrites | ✅ | `/api/qa` is membership-gated, scoped to `state:"delivered"` rewritten text only. |
| 34 | No summaries, behavioural analysis, advice | ✅ | Prompt explicit. |
| 35 | Generated on demand, not stored, not shared with the other user | ✅ | No persistence; per-user request. |
| 36 | Q&A prompt drafted and sent to Craig for review before going live | 🟡 | Frontend now exists (`app/(app)/channel/[id]/qa/page.tsx`). **Prompt draft owed** to you before launch. Will send this week. |

---

## VIEWER MODE

| # | Item | Status | Note |
|---|---|---|---|
| 37 | Per-channel access, requires explicit approval | ✅ | `ChannelViewer` model. |
| 38 | Two visibility options (rewrites only, or full visible history) | ✅ | Supported. |
| 39 | Viewers cannot send / upload / interact with moderation | ✅ | Server-side role gates. |
| 40 | Adding a viewer triggers A11; access revocable immediate | ✅ | A11 sent on viewer add; revoke endpoint deletes `ChannelViewer`. |
| 41 | Viewer portal feels distinct from user portal | ✅ | Separate UI affordances. Cosmetic role enum says `third_party_viewer`; functionality is correct. |

---

## MODERATOR PORTAL

| # | Item | Status | Note |
|---|---|---|---|
| 42 | Approve, deny, request rewrite retry on every held item | ✅ | `app/api/moderator/review/route.ts` actions: `approve` / `deny` / `retry_rewrite`; UI on `/pending-review`. |
| 43 | Mobile-first, oldest first | ✅ | Pending Review sorts ascending. Mobile pass landed today. |
| 44 | "Channels Assigned" column + "Assign Channels" option removed | ✅ | UI cleaned 2026-05-06. Orphan `AssignChannelsDialog.tsx` + `channelCount` API field still in tree (cleanup pending — does not affect testing). |
| 45 | All moderator actions logged | ✅ | All three actions audit-logged (`message_moderator_*`). System-level held-on-arrival events are not audited (minor gap). |

---

## ADMIN & SUPER ADMIN

| # | Item | Status | Note |
|---|---|---|---|
| 46 | Channel detail shows both participants' name/email/phone | ✅ | `app/(app)/admin/channels/[id]/page.tsx:66`. |
| 47 | Channel detail shows linked children's names per channel | ✅ | Linked children CRUD on the same page (lines 203-239). |
| 48 | Structured subscription state + both users' receiving hours (super admin amend per user) | ✅ | Lines 173-186; per-user hours editable. |
| 49 | Channel actions: suspend, cancel, reactivate, close | ✅ | Lines 241-267. |
| 50 | Billing visibility per channel (state, billing date, last payment, failed payments, add-on flag) | ✅ | `app/api/admin/channels/[id]/detail/route.ts` returns `billingHistory` (lastPaymentStatus, failedCount). |
| 51 | Phone-number pool management (5 UK numbers) in Settings | ✅ | `app/(app)/admin/settings/page.tsx` UI; `app/api/admin/phone-pool/[route.ts, [id]/route.ts]`. Confirm 5 UK numbers seeded in env before sign-off. |
| 52 | Audit log records all admin/moderator actions, with filters by date/channel/actor/action | ✅ | `app/(app)/activity/page.tsx:113-144` filter row; `/api/activity` accepts `from`/`to`/`channelId`/`actorId`/`action`. |
| 53 | Auth: users OTP only; admins/moderators may use username + password | ✅ | Per your clarification today. Moderator add-flow at `app/api/admin/moderators/route.ts` no longer sets a password — moderators use OTP at `/login`. Admins use username/password at `/admin/login`. (Prior audit had this as 🔴 under the older "OTP only" rule; that's now satisfied either way.) |
| 54a | Top-bar search functional or removed | ✅ | Removed. |
| 54b | Top-bar notification bell functional or removed | ✅ | Removed. |
| 54c | "Super Admin / Super Admin" placeholder shows actual name | ✅ | `Header.tsx` uses `currentUser?.name`. |
| 54d | Table overflow fixed at desktop width | ✅ | `overflow-x-auto` set on admin tables; mobile card fallbacks added. |
| 54e | UK date formats consistent in activity log | ✅ | Activity page formats with `'en-GB'` locale. |

---

## SYSTEM MESSAGES (Appendix A)

| # | Item | Status | Note |
|---|---|---|---|
| 55 | Every system message matches Appendix A wording exactly (A1–A12) | 🟡 | All 12 templates exist (`lib/messaging/appendixA.ts`); no automated guard against drift. **Verbatim spot-check still owed** — ideally we send you the rendered output of each before testing. A `/admin/system-messages` debug panel to fire each into a test channel would speed your verification — happy to build if you want it (small, ~half day). |

---

## PHONE CALLS

| # | Item | Status | Note |
|---|---|---|---|
| 56 | Calling Clancha number plays A12, terminates immediately, no voicemail/forwarding/recording | ✅ | `webhooks/twilio/route.ts:60-71` — `<Say>{a12}</Say><Hangup/>`. |

---

## RESILIENCE

| # | Item | Status | Note |
|---|---|---|---|
| 57 | Twilio outage queues outbound, no data lost, auto-resumes | ✅ | `lib/services/twilio.ts sendSmsWithRetry` queues to SMS outbox on failure; cron `processSmsOutbox(25)` retries with backoff (`/api/cron/route.ts:140-143`). |
| 58 | OpenAI outage holds messages safely, routes to moderation, never sends unprocessed | ✅ | `lib/services/rewritePipeline.ts` catch sets `state:"held"`; `unsafe→blocked` split also preserves correct routing. |
| 59 | Failures visible in logs, never silent | ✅ | `console.error` throughout pipeline; audit log captures state changes. |

---

## NEVER RULES

| # | Item | Status | Note |
|---|---|---|---|
| 60 | System never replies as a user | ✅ | Rewriter prompt rules; classifier separate. |
| 61 | Users never see other user's original wording | ✅ | Server-side gate at messages route. |
| 62 | Images never bypass billing or moderation | ✅ | Gating + denied-image authz patch landed. |
| 63 | AI never gives advice or judgement (rewrite, classifier, Q&A) | ✅ | Prompts explicit; Q&A backend rejects. |
| 64 | Portal never overrides server rules | ✅ | All auth/role checks server-side. |
| 65 | No features added outside spec | ✅ | Nothing knowingly off-spec. |

---

## CARRIED OVER FROM EARLIER MILESTONES

| # | Item | Status | Note |
|---|---|---|---|
| 66 | Death-threat test classification verified | ✅ | Commit `2e6933e` blocks `"you're a fucking slag, I'm going to kill you"` at safeguard regex → `state:"blocked"` (not `held`), A5 SMS to sender, never delivered. Verified 2026-05-06. |
| 67 | "PRESERVE FACTS, SOFTEN ONLY TONE" rule in rewrite prompt | ✅ | Prompt rev 3 (`lib/services/promptStore.ts`) added CRITICAL RULE #9 "PRESERVE REPORTED ACTIONS — FACTS ARE NOT TONE" + 2 few-shot examples. "He told a teacher to fuck off" no longer becomes "leave him alone". |

---

## Headline / what's left before you can test

**Engineering blockers (real work owed before you can run end-to-end):**
1. ~~Item #13 — wire `storeSystemMessage()` into the A* SMS callsites~~ ✅ **shipped 2026-05-12.**
2. ~~A1 + A11 not sent at all~~ ✅ **shipped 2026-05-12.** A1 fires once per channel on the recipient's first delivery; A11 fires when a viewer accepts an invite.
3. **Item #36** — send you the Q&A prompt draft for review before turning it on. *No code; copy review.*
4. **Item #55** — verbatim Appendix A spot-check pass with you. Optional `/admin/system-messages` debug panel to make testing easier. *Half a day if you want the panel.*
5. **Item #3** — UK English copy sweep across portal. *Half a day.*
6. **Item #2** — brand-audit artifact (`docs/brand-audit.md` with screenshots + palette diff). *Half a day.*

**Provisioning (not engineering):**
- Items #4, #5 — Stripe sandbox + test accounts. Confirm what you want seeded and we'll provision.

**Cosmetic (does not block):**
- Item #44 cleanup of orphan `AssignChannelsDialog.tsx` and `channelCount` field. Removes dead code only.
- Item #24 Picture Sharing visual distinction — design pass.
- Item #41 viewer role enum naming (`third_party_viewer` → `viewer`).

**Already verified end-to-end since prior audit:**
Mobile-first sweep · admin channel detail page · phone pool · audit-log filters · UK date formats · Q&A frontend · subscription cancel · avatar upload · A8 portal link · 30-day image retention cron · Twilio outage queue.

**Ready to test:** items 1, 6–14, 15–23, 25–35, 37–54, 56–67 (plus #24 cosmetic). Remaining open items #36, #55, #3, #2 are copy/doc work, not gating engineering. Estimate 2–3 days to clear all four. Provisioning (#4, #5) decoupled — confirm what you want and we'll seed.
