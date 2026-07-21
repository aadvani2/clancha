# Clancha Milestone Audit — 2026-05-06

**Branch audited:** `feature/clancha-milestone2` @ commit `2e6933e` + uncommitted session work (5 client-feedback items shipped 2026-05-06).
**Spec source:** `milestone.txt` (Craig's M4 sign-off testing checklist) cross-referenced with NotebookLM "Clancha Project" notebook.
**Method:** Refresh of `2026-04-30-milestone-audit.md`. Folded in commits `19bb92a` (text classification noise reduction — caused the 2026-05-01 safety regression) and `2e6933e` (defense-in-depth safety fix), plus the 5 items shipped today against `client_feedback.txt`.
**Companion doc:** `2026-04-30-milestone-audit.md` — keep for the M1–M5 scoreboard + investigation notes from the prior round. This file is organised around `milestone.txt`'s sign-off sections instead.

> Living document. When code in a section changes, update the section in place; bump filename date only on a fresh full pass.

---

## Scoreboard (milestone.txt sections)

| # | Section | Status |
|---|---|---|
| 1 | User Portal | ✅ Mostly done; profile-photo + brand-audit artifact gaps |
| 2 | Stripe Billing | ✅ Substantially done; pending end-to-end Stripe verification |
| 3 | Picture Sharing Add-on | 🟡 Functional; **denied-image authz bug**, no 30-day retention job |
| 4 | Q&A Search | 🟡 Backend done; **frontend chat UI missing**; prompt review draft owed to Craig |
| 5 | Viewer Mode | ✅ Done; minor naming nit (`third_party_viewer`) |
| 6 | Moderator Portal | ✅ Now complete (retry built + Channels Assigned removed today) |
| 7 | Admin & Super Admin Portal | 🔴 Several gaps — **channel detail page missing, audit-log filters missing, OTP-only auth contradicted by password flow** |
| 8 | Appendix A wording | 🟡 All 12 templates exist; needs verbatim spec diff and exact-copy enforcement framework |
| 9 | Phone Calls | ✅ A12 + Hangup, no voicemail/forwarding |
| 10 | Resilience | 🟡 OpenAI fail-safe done; **no Twilio outage queue** |
| 11 | Brand & Visual | 🟡 Palette + Poppins + responsive; no formal brand-audit artifact |
| 12 | What Must Never Happen | ✅ Largely enforced; one residual (denied-image leak) |
| 13 | Test setup Craig needs | ⚪ Provisioning action on stakeholders, not engineering |

**Headline:** M4 sign-off ~75% there. The five items in `client_feedback.txt` (2026-05-06) are now all addressed. The largest remaining engineering gaps are admin-portal completeness and moderator OTP auth (spec violation).

---

## What shipped 2026-05-06 (this session)

Cross-walks to `client_feedback.txt` items 1–5:

| # | Feedback item | Files | Status |
|---|---|---|---|
| 1 | Rewriter changes facts ("told a teacher to fuck off" → "told a teacher to leave him alone") | `lib/services/promptStore.ts` — added CRITICAL RULE #9 "PRESERVE REPORTED ACTIONS — FACTS ARE NOT TONE", strict-behaviour example, 2 few-shot examples; bumped `DEFAULT_REVISIONS.rewrite_system` 2→3 to override stale admin saves | ✅ |
| 2 | Threat classification routing (`"you're a fucking slag, I'm going to kill you"` went to Pending Review instead of being blocked) | `lib/services/rewritePipeline.ts:119-187` — split routing: `unsafe` → `state:"blocked"` + A5 SMS + audit log `message_blocked`; `uncertain` → `state:"held"` + queued-for-review SMS. Imports `a5MessageBlockedSms` | ✅ |
| 3 | Rewrite-retry option in Pending Review | `app/api/moderator/review/route.ts` accepts `action:"retry_rewrite"` (re-runs `classifyAndRewrite` with recipient tone, updates `rewrittenText`+`classification`, keeps state `held`, audit-logs `message_moderator_retry_rewrite`); image type rejected. `app/(app)/pending-review/page.tsx` — new "Retry rewrite" button (message-only); item updates in place | ✅ |
| 4 | Remove "Channels Assigned" column + Assign-Channels link | `components/admin/AdminModeratorTable.tsx` — column header, data cell, link icon button, `AssignChannelsDialog` import, `assignOpen`/`selectedModerator` state all removed; `colSpan` adjusted | ✅ (UI). API `channelCount` and `AssignChannelsDialog.tsx` left orphaned for follow-up cleanup |
| 5 | Admin channel page receiving hours | `app/api/channels/[id]/settings/route.ts` GET returns `participants[]` (admin only) with each user's hours; PATCH accepts `participantUpdates[]` scoped to channel members. `app/(app)/channel/[id]/settings/page.tsx` renders "Receiving hours" section with editable Start/End per user when admin. Emergency Bypass copy: "quiet hours" → "the recipient's receiving hours" | ✅ partial — covers the receiving-hours request; full admin **channel detail page** with names/emails/phones/billing/children remains missing (see §7) |

---

## 1. User Portal — ✅ mostly done

| Item | Status | Evidence / note |
|---|---|---|
| History shows own original + own rewrite + received rewrite; never the other user's original | ✅ | `app/api/channels/[id]/messages/route.ts:91-104` enforces `canSeeOriginal = isMember && isSender` |
| Receiving hours editable, immediate effect, per-user | ✅ | `app/(app)/settings/page.tsx:225-260`; per-user model since commit `d2f2247` |
| Tone toggle Calm & Clear / Firm & Fair, applied to messages user sends only | ✅ | `UserChannelPreferences.rewriteTone`; rewriter looks up recipient's preference for incoming, sender's for outgoing |
| Manage billing & channels | ✅ | Dashboard + Stripe portal |
| Picture sharing UI when active | ✅ | Uploader/timeline gates on `pictureShareEnabled` |
| All system messages display in portal history starting "Clancha" | 🟡 | A1–A12 SMS senders exist (`lib/messaging/appendixA.ts`); not all surface as inbound system messages in `activity/page.tsx`. **Verify A2/A4/A8/A10/A11 render in-portal.** |
| No edit/delete | ✅ | No mutation API for messages |
| Mobile-first / Poppins / approved palette / approved logos | 🟡 | Palette + Tailwind responsive done; **no brand-compliance audit artifact** |

## 2. Stripe Billing & Entitlement — ✅ substantially done

- 1 customer/account, £14.99 core/channel, £4.99 add-on/channel, single billing date — `lib/services/billing.ts`, `app/api/webhooks/stripe/route.ts`.
- Channel state machine (Trial / Active SMS / Active SMS+Picture / View-only / Closed) — `Channel.state`.
- View-only blocks send + triggers A10 — `app/(app)/channel/[id]/page.tsx:141`; webhook path enforces.
- **Pending Stripe sandbox verification:** mid-cycle add-on pro-ration, multi-channel single billing date, failed-payment → view-only transition, reactivation, cancellation. Depends on test data only stakeholders can provide.

## 3. Picture Sharing Add-on — 🟡 with bugs

| Item | Status | Evidence |
|---|---|---|
| Off by default, opt-in per channel | ✅ | `Channel.pictureShareEnabled` defaults false |
| Either user can enable | ✅ | `app/api/channels/[id]/settings/route.ts` PATCH |
| Portal-only upload (no MMS) | ✅ | MMS rejected with A6/A7 at `webhooks/twilio/route.ts:101-124` |
| AI precheck → human moderation | ✅ | `app/api/images/confirm/route.ts:38-49` calls `moderateImage()` then queues |
| Approved → A8 to recipient | 🟡 | A8 body has no image URL — recipient told an image is approved, no link to view (`lib/services/moderatorImageReview.ts:54` + `lib/messaging/appendixA.ts:75`) |
| Denied → A9 to sender | ✅ | `lib/services/moderatorImageReview.ts:84` |
| **Denied images admin-only** | 🔴 | `app/api/images/view/[imageId]/route.ts:11-12,28-29` allows public access by ID. Security bug. 2-line patch (add `requireAuth` + role check). |
| **30-day retention then permanent removal** | 🔴 | No cleanup cron / TTL. Not implemented. |
| Visually distinct core vs core+add-on UX | 🟡 | Subtle differences — needs design pass before sign-off |

## 4. Q&A Search — 🟡 backend only

- ✅ Backend: `app/api/qa/route.ts` is membership-gated, scoped to `state:"delivered"` rewritten text only, "do not invent" guard in prompt.
- 🔴 **Frontend chat UI not built** — no `/qa` page. Backend has been ready since prior audit.
- 🟡 **Prompt draft owed to Craig** before go-live (`milestone.txt:26`). Not yet sent.
- ✅ Refusal patterns will work once UI exists — backend prompt rejects summaries / advice / requests for the other user's originals.

## 5. Viewer Mode — ✅ done

- Per-channel approval, revocable, A11 trigger — `ChannelViewer` model, `app/api/invites/...`.
- Two access modes (rewritten-only vs full visible history with rewrites + permitted originals) — supported.
- Viewer never sees other user's original wording — `messages/route.ts:91-104` enforces.
- Distinct viewer portal — separate UI surface.
- Cosmetic: role enum says `third_party_viewer` not `viewer` (M1 #6 partial in prior audit).

## 6. Moderator Portal — ✅ complete (this session)

| Item | Status | Evidence |
|---|---|---|
| Approve, deny, **and request rewrite retry** on every held item | ✅ shipped today | `app/api/moderator/review/route.ts` (action `retry_rewrite`); `app/(app)/pending-review/page.tsx` (new button) |
| Mobile-first, one-handed, oldest first | ✅ | Pending Review page sorts by `createdAt` ascending |
| "Channels Assigned" column + "Assign Channels" option removed | ✅ shipped today | `components/admin/AdminModeratorTable.tsx` |
| All moderator actions logged | 🟡 | `approve`/`deny`/`retry_rewrite` audit-logged. System-level held-on-arrival (no moderator action) is not audit-logged — minor gap. |

## 7. Admin & Super Admin Portal — 🔴 multiple gaps

| Item | Status | Note / file |
|---|---|---|
| **Admin channel detail page**: both users' name/email/phone, structured sub state, both users' receiving hours, linked children, suspend/cancel/reactivate/close actions | 🔴 | **No dedicated admin channel detail page.** Only an API stub `app/api/admin/channels/[id]/route.ts:6-34`. Receiving-hours-for-both-users feature shipped today is on the channel **settings** page (`app/(app)/channel/[id]/settings/page.tsx`), not on a stand-alone admin channel detail. "Linked children" not modeled at all. |
| Billing visibility per channel (state, billing date, last payment status, failed payments, add-on flag) | 🟡 | `Subscription` model has the data; no admin UI surfaces it per channel |
| Phone-number pool mgmt for 5 UK numbers in Settings | 🟡 | `lib/services/numberPool.ts` exists; no admin UI wired |
| Audit log: all admin actions, prompt edits, moderator CRUD, channel/billing changes, logins, overrides, **with filters** by date/channel/actor/action | 🟡 | `AuditLog` model captures many events; `app/(app)/activity/page.tsx` displays them but **has no filters**. API `app/api/activity/route.ts` has no filter query params either |
| **Moderator auth: OTP / invite-link only, no passwords** | 🔴 | **Direct spec contradiction.** `app/api/admin/moderators/route.ts:85,93-117` requires + bcrypts a password; add-moderator dialog has password fields. Needs invite-link/OTP rebuild. |
| Admins cannot edit / alter messages | ✅ | No mutation endpoints on message bodies |
| Top-bar search functional or removed | 🔴 | `components/layout/Header.tsx:21-24` — input renders, no `onChange`/state/query. Decorative. Either wire it up or remove. |
| Top-bar notification bell functional or removed | 🔴 | `Header.tsx:29` Bell with no `onClick`. Same issue. |
| Profile photo upload functional or removed | 🔴 | `User.profileImageUrl` exists; no upload UI; falls back to DiceBear SVG. Either build upload or remove the field+avatar. |
| "Super Admin / Super Admin" placeholder shows actual user name | ✅ | `Header.tsx:15,39-42` uses `currentUser?.name` |
| Date format consistency in activity log | 🟡 | `formatDate()` is locale + relative — not a single canonical format |
| Table overflow fix at desktop on Moderators / Channels pages | 🟡 | `overflow-x-auto` set on `AdminModeratorTable`; visual confirmation pending |

## 8. Appendix A wording — 🟡 functions present, verbatim diff owed

`lib/messaging/appendixA.ts` defines all 12 templates (A1 line 27 → A12 line 98). Spec calls for **exact wording**. No automated guard prevents drift; building a "system-message framework with exact-copy enforcement" (M1 #11 in prior audit) remains open. Stakeholder verbatim spot-check still owed.

## 9. Phone Call Handling — ✅ done

`app/api/webhooks/twilio/route.ts:60-71` — incoming voice → `<Say voice="alice">{a12VoiceCallMessage()}</Say><Hangup/>`. No voicemail / recording / forwarding.

## 10. Resilience & Failure

- ✅ **OpenAI outage** — `lib/services/rewritePipeline.ts` catch block (around line 274) sets `state:"held"`, never delivers raw. Plus the `unsafe → blocked` split shipped today preserves correct routing when classification succeeds.
- 🔴 **Twilio outage** — no retry/queue mechanism. If `sendSms` returns failure, the message is logged but not re-tried. The `cron/route.ts` queue is for receiving-hours scheduling, not failure recovery.
- ✅ Failures visible in logs (`console.error` throughout pipeline).

## 11. Brand & Visual Alignment — 🟡

- Palette in `styles/globals.css` matches: `#4f7a61 #f2e8d9 #e8a675 #2F4A44 #33383B #FFFFFF`.
- Poppins applied via Tailwind config.
- Mobile-first responsive — yes.
- 🟡 **No formal brand-audit artifact** (M5 #6 in prior audit). Stakeholder may want one before sign-off.

## 12. What Must Never Happen — ✅ largely enforced

- ✅ System never replies as user — rewriter prompt rules + classifier separate.
- ✅ Other user's original never visible to non-sender — gated at messages route.
- 🟡 Images never bypass billing/moderation — gated, except the **denied-image public access bug** (Section 3 / Issue 4 in prior audit).
- ✅ AI provides no advice/judgement — prompts explicit; Q&A backend enforces.
- ✅ Portal never overrides server rules — auth + role checks server-side.
- 🟡 No unspecced features — depends on spec interpretation; nothing obviously off-spec added.

## 13. Test Setup Stakeholders Need — ⚪ provisioning, not engineering

Stripe test sandbox, multi-channel test accounts, picture-sharing-on / picture-sharing-off accounts, viewer accounts, A1–A12 trigger helpers. Mostly provisioning. Building a debug `/admin/system-messages` panel that fires A1–A12 against a chosen test channel would unblock the verbatim diff check.

---

## Subscription / billing audit (2026-05-06, post-feedback)

Deep audit of the end-to-end subscription journey surfaced 11 issues. All addressed:

| # | Issue | Status | Fix |
|---|---|---|---|
| 1 | `invoice.payment_failed` did not transition channels to view-only | ✅ Fixed | Webhook now updates both `Subscription.status` AND `Channel.state` for all channels under that sub; audit-logs `channel_payment_failed_view_only`. |
| 2 | Closing a channel didn't update Stripe (silent billing leak) | ✅ Fixed | New `applyChannelCloseToStripe` in `lib/services/billing.ts` decrements core qty + addon qty. Last-channel close cancels the subscription entirely. Wired into `/api/admin/channels/[id]` PATCH. |
| 3 | Picture Sharing add-on couldn't be toggled mid-cycle | ✅ Fixed | New `toggleChannelPictureSharing` in `billing.ts` adjusts addon line-item with `always_invoice` proration. Channel settings PATCH accepts `pictureShareEnabled`. New UI toggle on `/channel/[id]/settings`. |
| 4 | `Subscription.plan` was set globally per Stripe sub | ✅ Fixed | Webhook computes `plan` per channel from each channel's `pictureShareEnabled` flag; orphan/new docs use the parent sub's aggregate as a fallback only. |
| 5 | No webhook idempotency (Stripe redeliveries reprocessed) | ✅ Fixed | New `ProcessedWebhookEvent` model with unique `(source, eventId)` index + 30-day TTL. Webhook claims the event id at the top; on duplicate-key error, returns 200 with `duplicate: true`. |
| 6 | No `stripeSubscriptionItemId` tracking per Subscription | ⏭️ Not needed | Stripe items are price-shared (one core line, one picture line, with quantities) — close cleanup looks up items by price ID, no per-doc storage needed. |
| 7 | `User.activeStripeSubscriptionId` set before payment succeeded | ✅ Fixed | `/api/create-payment-intent` no longer writes this; webhook on `invoice.paid` is the only source of truth. |
| 8 | Trial expiry didn't notify users | ✅ Fixed | Cron sends A10 SMS to both users when a trial flips to view-only; audit-logs `channel_trial_expired`. |
| 9 | No user-facing channel restart UI | ✅ Fixed | View-only and closed states now show a banner on `/channel/[id]` with a "Restart channel" button routing to `/subscription`. |
| 10 | Subscription page called non-existent `/api/subscription/select-plan` | ✅ Fixed | Dead fetch removed. |
| 11 | `User.isPictureAddonEnabled` global flag conflicted with per-channel opt-in | ✅ Fixed | Webhook stops setting it; channel-creation paths read `Channel.pictureShareEnabled` directly. The field still exists on `User` for back-compat but is no longer load-bearing. |

**Bonus:** extended `AUDIT_ACTIONS` enum with the new event types (`channel_payment_failed_view_only`, `channel_trial_expired`, `channel_admin_*`, `channel_state_change`, `image_retention_purge`, `message_moderator_retry_rewrite`).

**Known limits of this fix sweep:**
- Webhook handler isn't fully transactional. If processing fails mid-flight, the idempotency claim stays and Stripe retries return `duplicate: true` — operator has to manually fix any partial state. Long-term fix is to make individual operations idempotent (`upsert`).
- Close-channel cleanup throws on Stripe errors but the Mongo state change (channel → closed) has already been written. The audit log captures the failure, but reconciliation is manual.
- Mid-cycle picture toggle for trial channels just flips the flag without Stripe — billing picks it up at first paid invoice. May need explicit handling if trial → active happens with picture enabled.

## Resolved since 2026-04-30 audit

- ✅ **Issue 6 — threat/slur bypass** (CRITICAL safety): commit `2e6933e` added slur regex to `lib/safeguard.ts`, removed the "zero non-filler words" heuristic, re-enabled classification, and tightened the classifier prompt. Verified today: `"you're a fucking slag, I'm going to kill you"` is now blocked at the safeguard regex, then routed to `state:"blocked"` (not `held`) by today's pipeline split.
- ✅ **Issue 5 — rewriter changes meaning on short messages**: commit `19bb92a` (and earlier prompt rev 2) added the PRESERVE SHORT & FRAGMENTARY MESSAGES rule; today's prompt rev 3 adds the parallel PRESERVE REPORTED ACTIONS rule.
- ✅ **Moderation routing for unsafe** (today): unsafe no longer pools with uncertain in `held` — unsafe now blocks per spec.
- ✅ **Moderator retry-rewrite** (today): spec requirement met.
- ✅ **Channels Assigned UI cleanup** (today): UI no longer references the removed per-moderator routing model.
- ✅ **Channel admin receiving-hours** (today): admin can see/edit both users' hours from the channel settings page; Emergency Bypass copy updated to "receiving hours".

---

## Action items, prioritised

1. **Denied-image authz** (Section 3 / 12) — 2-line `requireAuth` + role check on `app/api/images/view/[imageId]/route.ts`. Security; smallest patch.
2. **Moderator OTP / invite-link auth** (Section 7) — direct spec contradiction. Replace password create flow with invite-link generation; add OTP login endpoint for moderators; remove password fields from add-moderator UI. Mid-sized rebuild.
3. **Admin channel detail page** (Section 7) — net-new page. Today's receiving-hours work is the first piece. Pull together names/emails/phones/sub state/billing/children/admin actions.
4. **Audit-log filters** (Section 7) — extend `app/api/activity/route.ts` with query params (`from`, `to`, `channelId`, `actorId`, `action`); add filter row to `activity/page.tsx`. Date format pass while you're there.
5. **Q&A frontend** (Section 4) — chat-style page wired to existing `/api/qa`. Send Craig the prompt draft for review before launch.
6. **30-day denied-image retention cron** (Section 3) — schedule cleanup.
7. **Twilio outage queue** (Section 10) — retry on `sendSms` failure with backoff and dead-letter visibility.
8. **Header polish** (Section 7) — wire or remove search / notification bell / profile photo.
9. **A8 image-approval SMS** (Section 3) — include image URL or portal deep-link.
10. **Brand audit artifact** (Section 11) — `docs/brand-audit.md` with screenshots + palette diff.
11. **System-message exact-copy framework** (Section 8 / M1 #11) — model + lint to prevent Appendix A drift. A `/admin/system-messages` debug panel is a useful side-effect.
12. **Cleanup of orphans from today's #4** — delete `components/admin/AssignChannelsDialog.tsx` and stop computing `channelCount` in `app/api/admin/moderators/route.ts` if confirmed safe.

Items 1, 4, 6, 7, 8, 9, 12 are concrete and small. Items 2, 3, 5, 10, 11 are larger.

---

## How to refresh this audit

1. Run NotebookLM: `mcp__notebooklm__ask_question` against notebook `clancha-project` (existing session `db67dc08`) to re-pull spec deliverables if the spec source changed.
2. Re-read the latest `client_feedback.txt` and any new commits since this audit's base SHA.
3. Diff status changes section by section and update in place. Bump filename date only on a fresh full pass.
