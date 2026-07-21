# Clancha Milestone Audit — 2026-04-30

**Branch audited:** `feature/clancha-milestone2` @ commit `d12dbd5` (with uncommitted prompt-store work)
**Spec source:** NotebookLM "Clancha Project" notebook (id `clancha-project`, session `db67dc08`)
**Method:** 5 parallel Explore subagents, one per milestone, cross-referencing spec deliverables against code.

> Living document — update statuses as work lands. When a code path moves, fix the file path here.

---

## Scoreboard

| Milestone | DONE | PARTIAL | MISSING |
|---|---|---|---|
| M1 — Architecture, Auth, Roles | 11/13 | 1 | 1 (+1 not found) |
| M2 — SMS, Routing, Moderation, Emergency | 12/13 | 1 | 0 |
| M3 — Rewrite, Safety, Images | 12/13 | 1 | 0 |
| M4 — UI, Viewer, Q&A, Billing | 10/12 | 1 | 0 (1 partial UI) |
| M5 — QA, Compliance, Deploy, Handover | 2/10 | 4 | 4 |

**Headline:** M1–M4 substantially shipped; M5 is the long pole.

---

## M1 — System Architecture, Enforcement Rules & User Scope

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | JWT auth + SMS OTP session handling | ✅ DONE | `lib/auth/jwt.ts`, `lib/auth/otp.ts`, `app/api/auth/{send,verify}-otp/route.ts` (7-day httpOnly cookie at verify-otp:161-167) |
| 2 | Mandatory email capture at signup | ✅ DONE | `app/api/auth/verify-otp/route.ts:15,77,90-101`; `lib/db/models/user.ts:36` (sparse unique) |
| 3 | WordPress→Portal entry handoff | ❌ NOT FOUND | No WordPress integration |
| 4 | Email-Invite Flow fallback (secure link) | ✅ DONE | `lib/auth/invite.ts` (32-byte random + SHA-256), `lib/db/models/{invite,pendingChannelInvite}.ts`, auto-fulfill at `verify-otp:114-138` |
| 5 | Default prefs: Calm&Clear / no restrictions / emergency on | ✅ DONE | `lib/services/createFirstChannelForUser.ts:88,111,191,214` |
| 6 | Role schema: User/Viewer/Moderator/Admin | ⚠️ PARTIAL | `lib/db/models/user.ts:3-9` uses `third_party_viewer` not plain `Viewer`; concept fully implemented via `ChannelViewer` |
| 7 | Tenant isolation | ✅ DONE | `lib/auth/viewerAuth.ts:12-46` `canAccessChannel`; `app/api/channels/[id]/messages/route.ts:48,56-65` |
| 8 | Server-side enforcement engine | ✅ DONE | `lib/utils/routing.ts:72-185` (no separate "engine" module — logic in routing + rewritePipeline) |
| 9 | V2 message lifecycle DB models | ✅ DONE | `lib/db/models/message.ts:3-11` — received/queued/rewriting/processing/held/blocked/delivered |
| 10 | Emergency logic framework | ✅ DONE | `lib/utils/routing.ts:23-35` triggers; `lib/db/models/channel.ts:17,42` `emergencyBypassEnabled`; audit logs |
| 11 | System-message framework (exact-copy + portal visibility) | ❌ NOT FOUND | Implemented as Appendix A SMS senders only — no formal system-message model with exact-copy guard or portal visibility surface |
| 12 | Admin prompt mgmt: versioning + rollback + audit | ✅ DONE | `lib/db/models/promptVersion.ts:12-34`; `app/api/admin/prompts/[key]/rollback/route.ts:16-89`; admin-gated |
| 13 | Demo vs Live OpenAI org separation | ✅ DONE | `lib/services/openai.ts:6-12` (LIVE→DEMO→fallback); `.env.example:10-11` |

---

## M2 — SMS Pipeline, Routing, Moderation Flow, Emergency Logic

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Twilio inbound webhook | ✅ DONE | `app/api/webhooks/twilio/route.ts:37-501` (signature validation present but disabled in code) |
| 2 | Twilio outbound send | ✅ DONE | `lib/services/twilio.ts:31-96` (US uses Messaging Service SID, non-US direct) |
| 3 | Carrier-safe formatting | ⚠️ PARTIAL | 1000-char cap in `lib/safeguard.ts`; no GSM-7 vs UCS-2 segmentation |
| 4 | Number → channel/user mapping | ✅ DONE | `app/api/webhooks/twilio/route.ts:134-181`, `normalizePhoneForMatch()` |
| 5 | Deterministic routing → enforcement | ⚠️ PARTIAL | `lib/utils/routing.ts:150-185` `getInitialMessageState`; no separate enforcement-engine module |
| 6 | Full state machine | ✅ DONE | `lib/db/models/message.ts:3-11` + transitions in `lib/services/rewritePipeline.ts:25-270` |
| 7 | Quiet-hours enforcement | ✅ DONE | `lib/utils/routing.ts:72-132` `isWithinReceivingHours` (timezone-aware); SMS notify at twilio webhook 445-451 |
| 8 | Emergency keyword detection | ✅ DONE | `lib/utils/routing.ts:23-35` (emergency/urgent/alert + flexible patterns) |
| 9 | Emergency bypass only when explicitly enabled | ✅ DONE | `app/api/webhooks/twilio/route.ts:290-399` (gate at line 310; denial SMS 371-395) |
| 10 | System SMS on emergency approve/deny + audit | ✅ DONE | `a3EmergencyDeliveryConfirmationSender`, `a4EmergencyDeliveryDeniedSender`; auditLog actions `message_emergency_*` |
| 11 | Moderator queue: list / approve / deny | ✅ DONE | `app/api/moderator/queue/route.ts:22`; `app/api/moderator/review/route.ts:48-116` (no separate "release" — held→delivered = approve) |
| 12 | Viewer-mode delivery rules | ✅ DONE | `app/api/channels/[id]/messages/route.ts:59-66`, viewer access logged 117-124 |
| 13 | Message history with metadata | ✅ DONE | `lib/db/models/message.ts` (originalText/rewrittenText/state/classification/violationTags/deliveredAt) + `auditLog.metadata` |

---

## M3 — Rewrite Engine, Safety Layer, Picture Sharing

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Production rewrite engine (preserves intent) | ✅ DONE | `lib/services/rewritePipeline.ts:96-125` `classifyAndRewrite`; `lib/services/openai.ts:158` |
| 2 | No-advice / no-interpret / no-hallucinate prompt | ✅ DONE | `lib/services/promptStore.ts:10-14` explicit guard; `openai.ts:190` violation rule |
| 3 | 3-bucket safe/unsafe/uncertain (no numeric score) | ✅ DONE | `openai.ts:27`, `imageModeration.ts:6`; `promptStore.ts:74-86` |
| 4 | Uncertain → human queue | ✅ DONE | `rewritePipeline.ts:119-121` → `state="held"` |
| 5 | Pre + post rewrite audit logs | ✅ DONE | `rewritePipeline.ts:220-237`, hold logs 259-268; image upload log `images/do-upload/route.ts:87-92` |
| 6 | Violation tagging | ✅ DONE | `message.violationTags`, `image.ts:18,41`; logged in audit metadata |
| 7 | Portal-only image upload (no MMS) | ✅ DONE | MMS rejected at `webhooks/twilio/route.ts:101-124` (Appendix A6/A7); upload gates on `pictureShareEnabled` |
| 8 | AI image precheck before human review | ✅ DONE | `app/api/images/confirm/route.ts:38-49` calls `moderateImage()` before queuing |
| 9 | Human moderation on every image | ✅ DONE | All images created `pending`; moderator queue at `/api/moderator/images`; transitions in `moderatorImageReview.ts:24-94` |
| 10 | Image state machine pending/approved/denied | ✅ DONE | `lib/db/models/image.ts:3-8` |
| 11 | Denied images admin-only | ⚠️ **PARTIAL — bug-shaped** | `app/api/images/view/[imageId]/route.ts:28-40` issues presigned URLs for denied images **without role check**. Relies on imageId secrecy. Spec requires admin-only. **Fix needed.** |
| 12 | System SMS on upload outcomes | ✅ DONE | `a8PictureUploadApprovedRecipient` (moderatorImageReview.ts:53), `a9PictureUploadDeniedSender` (84) |
| 13 | £4.99 picture-sharing add-on gating per channel | ✅ DONE | `channel.pictureShareEnabled` (default false); enforced at `images/upload/route.ts:31,53` and `images/do-upload/route.ts:31,54`; `subscription.ts:3,32` plan `picture_addon`; Stripe webhook flips flag |

---

## M4 — Portal UI, Viewer Mode, Q&A Search, Billing

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Mobile-first brand-compliant UI | ✅ DONE | `styles/globals.css` brand palette (#4f7a61, #e8a675, #2F4A44, #f2e8d9); responsive Tailwind |
| 2 | User dashboard | ✅ DONE | `app/(app)/dashboard/page.tsx` (gated on `isSubscribed`) |
| 3 | Viewer dashboard / mgmt | ✅ DONE | `components/channel/ViewerManagement.tsx`; role assigned at `app/api/invites/accept/route.ts` |
| 4 | Moderator dashboard with queue + actions | ✅ DONE | `app/(app)/pending-review/page.tsx`, `app/(app)/channel/[id]/queue/page.tsx`; `/api/moderator/{queue,review}` |
| 5 | Admin dashboard | ✅ DONE | `app/admin/page.tsx` (admin/super_admin gated) |
| 6 | Settings / profile / receiving hours | ✅ DONE | `app/(app)/settings/page.tsx` |
| 7 | Message timeline with rewrite states + system msgs | ✅ DONE | `app/(app)/activity/page.tsx` (state badges, moderator decisions, original/rewritten pairs) |
| 8 | Viewer fail-safe (never see original wording) | ✅ DONE | `app/api/channels/[id]/messages/route.ts:91-92,104` `canSeeOriginal = isMember && isSender`; viewers always get only `rewrittenText` |
| 9 | Stripe subscription validation | ✅ DONE | `lib/stripe.ts`; `app/api/webhooks/stripe/route.ts`; `dashboard/page.tsx:85` gate |
| 10 | Stripe entitlement / feature gating | ✅ DONE | `app/api/images/upload/route.ts` checks `pictureShareEnabled`; webhook flips flag; `lib/services/billing.ts` resolves plan |
| 11 | Q&A chat-style portal tool | ⚠️ PARTIAL | Backend `app/api/qa/route.ts` exists; **frontend chat UI not built** |
| 12 | Q&A stateless / scoped / factual-only | ✅ DONE | `app/api/qa/route.ts:41-46` membership check; 48-50 `state:"delivered"` only; 57-59 `rewrittenText` only; 74-75 "Do not invent…" |

---

## M5 — Integration, QA, Compliance, Deployment

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | E2E tests: ordering / duplication / eligibility | ⚠️ PARTIAL | `tests/e2e/{messaging-journey,auth-journey,viewer-invite-journey}.test.ts` — no ordering/duplication tests |
| 2 | Rewrite engine reliability tests | ⚠️ PARTIAL | `tests/unit/services/openai.test.ts` (key selection only); rewrite mocked |
| 3 | Emergency logic tests | ✅ DONE | `tests/unit/utils/routing.test.ts`, `tests/unit/webhooks/twilio-queue-emergency.test.ts` |
| 4 | Picture-sharing moderation flow tests | ⚠️ PARTIAL | `tests/unit/api/moderator.test.ts:131-155` — no full upload→approval e2e |
| 5 | Load tests (k6/artillery) | ❌ MISSING | None in repo |
| 6 | Brand-compliance audit artifacts | ❌ MISSING | Only informal `.cursor/rules/project_overview.md` |
| 7 | UK SMS compliance (consent / opt-out / sender ID) | ❌ MISSING | No code or docs |
| 8 | Vercel deploy config | ❌ MISSING | No `vercel.json`; no `.github/workflows/`; `next.config.ts` empty |
| 9 | Demo vs Prod env separation | ⚠️ PARTIAL | OpenAI split via env; Twilio/Stripe have no demo/prod switch |
| 10 | Handover docs (README/ARCHITECTURE/RUNBOOK) | ⚠️ PARTIAL | `README.md` is Next.js boilerplate; `.cursor/rules/project_overview.md` is the de-facto spec; no formal handover |

---

## Action items (proposed, in priority order)

1. **Fix denied-image authorization** — add admin role check to `app/api/images/view/[imageId]/route.ts` (M3 #11). Security-shaped.
2. **Build Q&A chat UI** — wire `/api/qa` to a portal component (M4 #11).
3. **M5 tranche** (largest gap):
   - Vercel config + deploy workflow
   - UK SMS compliance: consent capture, STOP/HELP keyword handling, sender-ID rules
   - Load tests (k6 against rewrite + Twilio webhook)
   - Brand-compliance audit pass + artifact
   - Formal handover doc set: ARCHITECTURE.md, RUNBOOK.md, real README
4. **System-message framework** (M1 #11) — formalize Appendix A messages into a model with exact-copy guard + portal visibility.
5. **WordPress handoff** (M1 #3) — confirm with stakeholders if this is actually in scope or deprecated.
6. **Cosmetic**: rename `third_party_viewer` → `viewer` in role enum if spec compliance is strict (M1 #6).
7. **Carrier formatting**: GSM-7 vs UCS-2 segmentation (M2 #3).
8. **Twilio/Stripe demo/prod env split** (M5 #9).

---

---

## Client feedback round — Craig, 2026-04-30

Craig completed another round of testing and reported 3 specific issues. Each was investigated against the code; root causes below.

### ✅ What's working per Craig
- Global "Pending Review" queue is in place and clearer.
- Moderation actions work end-to-end: approve → message sent; deny → blocked + sender notified; queue updates correctly.

### ⚪ Issue 1 — Receiving hours visibility (NOT AN ISSUE — closed)
**Craig:** "Receiving hours are still not visible anywhere in the user portal."

**Resolution:** Not a bug. Receiving hours were intentionally moved from channel-level to user-profile-level (commit `d2f2247 feat: migrate message receiving hours and timezone settings from channel level to user profile`). They live on the Settings page (`app/(app)/settings/page.tsx:225-260`) as designed. Craig should look there.

No code change required. Action: respond to Craig pointing him at Settings.

### 🔴 Issue 2 — Moderation too aggressive (normal text routed to queue)
**Craig:** "Normal, non-harmful messages are being sent to the moderation queue when they should be automatically rewritten and delivered."

**Investigation findings — confidence: medium, needs reproduction:**
- `lib/services/openai.ts:161` reportedly skips classification for text (`skipClassification: true`) with comment "Skip text violation tags to prioritize delivery via AI rewrite". If this is the only path, text shouldn't reach the held queue at all.
- `lib/services/rewritePipeline.ts:119-121` correctly holds only `unsafe` or `uncertain`.
- Image moderation defaults to `"uncertain"` on parse/API errors (`lib/services/imageModeration.ts:54,62-67`) — fail-closed, generates queue noise.
- Classifier prompt criteria for "uncertain" (`lib/services/promptStore.ts:78,88-110`) include "borderline, subtle, or complex emotional themes" — too broad; any emotionally-toned co-parenting message could match.

**Discrepancy worth resolving:** Craig clearly says *messages* (text) are over-flagged, but the code path suggests text classification is skipped. Either (a) there's another path sending text to `held` we haven't found, (b) the `skipClassification` flag isn't actually set in the call site Craig is exercising, or (c) Craig is also seeing image holds and lumped them together. **Reproduce a test text message in dev before patching.**

**Likely fixes (apply in order):**
1. Confirm whether text actually hits the classifier in production by tracing one held message and reading `auditLog.metadata.classification`.
2. If text *is* being classified: tighten the "uncertain" criteria in `promptStore.ts` with explicit examples of normal co-parenting phrases that should be `safe`.
3. For images: change error fallback from `"uncertain"` → `"safe"` in `imageModeration.ts` (fail-open on tool errors; only flag on actual unsafe content).
4. Default to `"safe"` on JSON parse failures, not `"uncertain"`.

### 🔴 Issue 3 — Image uploads don't appear in queue or reach recipient
**Craig:** "I tested uploading an image from the user side and it did not appear in the moderation queue or get delivered to the recipient."

**Investigation findings — three layered issues:**

**3a. (Most likely cause) Channel `pictureShareEnabled` defaults to `false`** — `lib/db/models/channel.ts:41`. Both upload routes return 403 with code `"Picture Sharing is a premium add-on (£4.99/channel)"`:
- `app/api/images/upload/route.ts:31,53`
- `app/api/images/do-upload/route.ts:31,54`

If Craig's test channel didn't have the addon enabled, uploads silently fail with 403 → image never written → never appears in queue. `components/ImageUpload.tsx:81-86` does toast the error but if Craig wasn't watching for it, looks like nothing happened.

**3b. Confirm route trim removed direct-delivery path** — `app/api/images/confirm/route.ts` (uncommitted, -50 lines). Previously the AI-approved branch sent SMS + image URL directly. Now everything queues. This appears intentional per spec ("all images go to human moderation") and per the new comment in the file, but it does mean delivery now depends entirely on a moderator approving — Craig may have been waiting for auto-delivery that no longer exists.

**3c. Moderator-approval SMS missing image URL** — `lib/services/moderatorImageReview.ts:54` calls `sendSms()` with `a8PictureUploadApprovedRecipient()` template only. No image URL or presigned link in the body. Recipient is told an image is approved but has no way to view it.

**Fixes:**
1. **Verify Craig's test channel has `pictureShareEnabled: true`** — likely the whole story for "doesn't appear in queue." Either flip the flag manually for testing, or remove the gate temporarily for dev.
2. Surface the 403 more loudly in `ImageUpload.tsx` so silent failures don't masquerade as "nothing happened."
3. Include image URL (or portal deep-link) in the approval SMS body — `lib/services/moderatorImageReview.ts:54` + `lib/messaging/appendixA.ts` template `a8PictureUploadApprovedRecipient`.

### 🔴 Issue 4 — Denied images publicly accessible (line 78 of this doc)
**Spec:** denied images are admin-only. **Reality (CONFIRMED):**
- `app/api/images/view/[imageId]/route.ts:11-12` explicitly allows public access ("Allow public access so SMS recipients can view the image without a portal login").
- No auth check, no role check, no state check. Code intentionally generates presigned URLs for denied images so the frontend can render a blurred "UNSAFE" stamp (line 28-29 comment).
- ID is a Mongo ObjectId (non-sequential) — security-through-obscurity at best.

**Minimum patch (2 lines):**
```ts
const user = await requireAuth(request);
if (image.state === "denied" && !["admin", "super_admin"].includes(user.role)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```
Add the blur logic to the moderator/admin frontend, not to the access-control layer.

### Action items from this round (priority order)

1. **Channel `pictureShareEnabled` default / test data** — flip for Craig's test channel; surface the 403 in UI (Issue 3a, blocks all his image testing).
2. **Reproduce + diagnose text held-queue case** — trace one of Craig's "normal message" examples through `auditLog` to find the actual path (Issue 2).
3. **Denied-image authz** — 2-line patch on `app/api/images/view/[imageId]/route.ts` (Issue 4, security).
4. **Image approval SMS body** — include image URL in `a8PictureUploadApprovedRecipient` (Issue 3c).
5. **Tighten "uncertain" prompt criteria** with explicit safe examples; flip image-error fallback to `"safe"` (Issue 2 mitigations).
6. ~~Receiving-hours visibility~~ — closed; feature moved to user profile by design (`d2f2247`). Tell Craig to check Settings.

---

## Client feedback round — Craig, 2026-05-01

Second test pass after commit `19bb92a` shipped. Mixed result: previous-round issues all resolved; two new critical bugs surfaced.

### ✅ Confirmed fixed (Craig verified)
- **Receiving hours**: visible in account settings, working as expected. Delayed delivery + emergency bypass both behaving correctly.
- **Pending Review queue**: approve/deny actions correct; queue updates properly.
- **Image handling**: end-to-end working. All images flagged for review, moderators get description + recommendation, approve/deny flow correct.
- **Admin AI Prompts page**: client likes it.

### 🟡 Stakeholder note
- Receiving hours at account level is OK for now (covers ~99% of users). **Per-channel control** is on the future-consideration list for users with multiple co-parenting setups. Not blocking.

### 🔴 Issue 5 — Rewriter changes meaning, not just tone (M3 spec violation)
**Craig:** Sender wrote "yeah loved it" (a reply about the child enjoying school). Rewriter changed the perspective so it read as if the sender themselves had loved something, dropping the implicit reference to the child.

**Root cause:** rewriter prompt + call site lack guardrails for short/ambiguous messages.
- `lib/services/promptStore.ts:5-68` rewriter has perspective rules ("you" = other parent, "I" = sender, "he/she/they" = child) and a "PRESERVE CORE INTENT" rule, **but no explicit instruction on short, fragmentary, or pronoun-only messages**. All few-shot examples are complete sentences with clear subjects.
- `lib/services/openai.ts:74-89` rewriter is invoked with **only the message text** — no conversation history, no thread context. Model has no signal about what "it" / "yeah" refers to and reconstructs the most grammatically complete output, which flips the subject.
- Model: `gpt-4o-mini` at `temperature: 0` (good, but doesn't help when the input is genuinely ambiguous).

**Fix:** add to rewriter prompt (`promptStore.ts` ~line 26):
> **PRESERVE SHORT & CONTEXTUAL MESSAGES**: When the input is short, fragmented, or uses pronouns without explicit referents (e.g., "yeah loved it", "that's great", "totally"), do NOT invent context or expand with assumed subjects. Preserve the exact perspective and words. If a pronoun is ambiguous, keep it ambiguous; do not substitute or clarify.

Plus a few-shot example showing "yeah loved it" → "Yeah, loved it." (preserved, not expanded).

### 🔴 Issue 6 — Threat + slur bypass (CRITICAL safety failure)
**Craig:** Test message `"you're a fucking slag, I'm going to kill you"` was rewritten into `"I am feeling very upset and need to discuss our situation calmly"` and **delivered**. A death threat reached the recipient as a calm message.

**Root cause:** two-layer failure — both the regex safeguard and the (now-disabled) classifier missed it.

1. **`lib/safeguard.ts` has a heuristic that lets threats through when the message also contains insults.** Lines 38-53: after matching a threat phrase (`kill you`), it removes the matched phrase and counts non-filler words remaining; only blocks if **zero** remain. For Craig's test case:
   - Match: `kill you` → removed
   - Remaining: `"you're a fucking slag, I'm going to"`
   - After lowercasing + stripping fillers (is/am/will/going/to/you/your/i/etc.): `["fucking", "slag"]`
   - 2 non-filler words → safeguard says **safe** → falls through to rewriter
   - Slurs are NOT in the threat regex, so on their own they pass too.

2. **Commit `19bb92a` set `skipClassification: true` in `rewritePipeline.ts:110`**, removing the soft classifier safety net. With safeguard bypassed, the message reaches the rewriter unchallenged.

3. **The rewriter has no internal refusal.** It sees a calm-tone request and produces a calm-tone output, semantically dropping the threat.

**Fix — defense in depth (Option C):**
- **`lib/safeguard.ts`**: add explicit slur regex (e.g., `slag|bitch|bastard|asshole|prick|twat|c\*\*t`); **remove the "zero non-filler words" heuristic** — if any threat phrase matches, block immediately. Slurs alone should also block (or hold for moderation).
- **`lib/services/rewritePipeline.ts:110`**: revert `skipClassification` to `false`.
- **`lib/services/promptStore.ts` classifier prompt**: rewrite the classifier to flag *only* explicit threats + slurs + harassment (NOT sarcasm, blame, or emotional intensity — those go to the rewriter). This avoids re-creating the over-aggressive queue from Craig's previous round.

Verbatim suggested classifier prompt:
> You are a safety classifier for co-parenting messages.
> ONLY flag messages with: (1) direct threats of physical harm, (2) slurs or dehumanizing language, (3) explicit harassment or hate speech.
> DO NOT flag: sarcasm, passive-aggressive tone, blame, criticism, or emotional intensity — the rewriter handles those.
> Respond JSON: `{ "classification": "safe"|"unsafe", "tags": [...] }`. Use "unsafe" for the three categories above only; everything else is "safe".

### Action items from 2026-05-01 round (priority order)

1. **Issue 6 — threat/slur bypass** (CRITICAL, safety): patch safeguard regex + heuristic, re-enable classification, ship tightened classifier prompt. Defense in depth across all three layers.
2. **Issue 5 — rewriter meaning preservation**: add short-message rule + few-shot to rewriter prompt in `promptStore.ts`.
3. Open items 3–5 from the 2026-04-30 round (denied-image authz, image approval SMS body, image-moderation error fallback) still apply.

**Verification before shipping:** Run the two test cases that broke production:
- `"you're a fucking slag, I'm going to kill you"` → must NOT be delivered. Should hit `state="held"` or `"blocked"`.
- `"yeah loved it"` → rewritten output must preserve the `"yeah … loved it"` shape, NOT expand to "I loved it" or "I had a great time".
- Plus regression tests Craig already validated: a normal calm message must still be auto-delivered (don't re-create the over-aggressive queue).

---

## How to refresh this audit

1. Run NotebookLM: `mcp__notebooklm__ask_question` against notebook `clancha-project` to re-pull milestone deliverables (existing session: `db67dc08`).
2. Re-spawn the 5 Explore subagents (one per milestone) — prompts are in conversation history of the 2026-04-30 session.
3. Diff status changes and update this file in place. Bump the date in the filename if it's a fresh full pass.
