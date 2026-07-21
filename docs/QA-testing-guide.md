# Clancha — QA Testing Guide

A self-contained guide for testing the Clancha staging environment end-to-end. Read sections 1–5 once before you start. Use sections 6 onward as a checklist while you test.

---

## 1. What Clancha is

Clancha is an SMS-based communication service for separated co-parents. Every text message between the two parents passes through Clancha's safety layer before it's delivered, so:

- Calm messages pass through unchanged.
- Mildly hostile messages get **softened** by a rewrite engine (e.g. *"You never help with homework"* → *"I feel you don't help often with homework"*) before being delivered.
- Genuinely abusive messages are **blocked** before they reach the recipient.
- Borderline cases are **held** for a human moderator to review.

The product mission is to protect the recipient from escalation while preserving the sender's legitimate intent. The system never invents content, never gives advice, and never speaks on a user's behalf.

A "Viewer" role exists so that a third party (e.g. a parent's lawyer or therapist) can monitor a channel with read-only access. Image sharing is a paid add-on with both AI and human moderation. Admins manage channels, moderators staff the review queue.

---

## 2. Key concepts (glossary)

| Term | Meaning |
|---|---|
| **Channel** | One communication relationship between two parents, optionally with children attached. Each channel is billed independently. |
| **Clancha number** | The phone number the two parents text. Each channel is allocated one from a small UK pool. Parents never see each other's real numbers. |
| **Rewrite engine** | The AI that softens tone in messages before delivery. Uses two prompts: a classifier and a rewriter. |
| **Classifier** | Decides whether a message is `safe`, `unsafe`, or `uncertain`. |
| **Safe** → delivered (possibly after rewriting). |
| **Unsafe** → blocked, sender sees A5 message, recipient gets nothing. |
| **Uncertain** → held, queued for a moderator, recipient sees nothing until moderator approves. |
| **Safeguard layer** | A regex-based pre-check that blocks the most obvious abuse (threats, slurs, bare insults) before the AI even runs. |
| **Receiving hours** | Each user's preferred window for receiving messages. Outside the window, messages queue until the next opening. |
| **Emergency bypass** | A keyword that lets a sender override the recipient's quiet hours, only if the recipient has enabled the feature. |
| **Tone** | Each user picks between "Calm & Clear" (default) and "Firm & Fair" — applied to the messages **they receive** (i.e. how the rewriter softens incoming messages). |
| **Appendix A messages** | The 12 pre-defined system SMS templates (A1–A12) that Clancha sends in specific lifecycle events. They always start with "Clancha:". |

---

## 3. Roles

| Role | Login method | What they can do |
|---|---|---|
| **User** (Parent) | Phone number + SMS OTP | Send/receive messages on their channels, manage receiving hours and tone, upload images (if Picture Sharing is enabled), cancel their subscription. |
| **Viewer** | Email invite + SMS OTP | Read-only access to a channel. Can see rewrites (and optionally originals depending on setting). Cannot send, upload, or moderate. |
| **Moderator** | Phone number + SMS OTP | Review held messages and pending images. Three actions: Approve, Deny, Retry rewrite. |
| **Admin** | Username + password | See all channels, suspend/reactivate/close channels, view billing, edit users' receiving hours, manage moderators, view audit log. |
| **Super Admin** | Username + password | Everything Admin can do, plus per-user receiving hours amendments and phone-pool management. |

---

## 4. System messages (Appendix A)

Each of these SMS templates is sent automatically by the system in specific situations. They always begin with "Clancha:" and appear in the user's portal chat history as a centred grey strip labelled "CLANCHA".

| Code | When sent | To whom |
|---|---|---|
| **A1** | First message ever delivered on a channel | Recipient — introduces them to Clancha |
| **A2** | Channel created by other parent | Invited parent |
| **A3** | Recipient's tone preference changed | Recipient (confirmation) |
| **A4** | Receiving hours updated | The user who changed them |
| **A5** | Sender's message blocked as unsafe | Sender |
| **A6** | MMS / image arriving on inbound SMS (not allowed) | Sender |
| **A7** | Image upload attempted while add-on inactive | Sender (with upgrade link) |
| **A8** | Image approved and delivered | Recipient (with portal view link) |
| **A9** | Image denied | Sender |
| **A10** | Channel went view-only (payment failure) | Both users |
| **A11** | Viewer added to channel | Both users on the channel |
| **A12** | Someone called the Clancha number | Played as voice, then hang up |
| **Held** | Sender's message held for moderator review | Sender (operational copy) |

---

## 5. Milestones — what is being tested

The product was delivered in five milestones. Knowing what each covers helps you understand which feature each test is exercising.

- **M1 — Architecture, Auth, Roles**
  JWT auth, SMS OTP for users, username/password for admins/moderators, role-based access, system message framework, admin prompt management.

- **M2 — SMS pipeline, routing, moderation, emergency**
  Twilio SMS in/out, channel routing, message state machine (queued, rewriting, held, blocked, delivered), quiet-hours queueing, emergency keyword bypass, moderator queue, viewer-mode delivery rules.

- **M3 — Rewrite engine, safety, picture sharing**
  The classifier and rewriter, the 3-bucket safety model (safe/unsafe/uncertain), audit logging, the £4.99 picture-sharing add-on with AI+human moderation.

- **M4 — Portal UI, viewer mode, Q&A, billing**
  The web portal (mobile-first), Stripe subscriptions, viewer-mode interface, Q&A factual search, sender-side state pills on messages.

- **M5 — Integration, QA, compliance, deployment**
  End-to-end tests, deployment to staging/prod, compliance documentation.

Your testing exercises M1–M4 mainly, with M5 being a meta-concern about reliability.

---

## 6. Before you start — environment setup

### What you need from your team lead

Get these values and write them in this table before starting:

| Item | Value |
|---|---|
| Staging portal URL | `https://_________________` |
| Admin login URL | `https://_________________/admin/login` |
| Admin username | `_______________` |
| Admin password | `_______________` |
| Moderator phone number (for OTP) | `_______________` |
| Two real UK mobile numbers you control (Phone-A, Phone-B) | A: `___________` B: `___________` |
| Optional third number for Viewer testing (Phone-C) | C: `___________` |
| The Clancha test number to text | `___________` |
| Stripe test card number | `4242 4242 4242 4242` (universal test card) |
| Stripe test expiry / CVC | `12/30` / `123` |

### What you need on your devices

- A laptop / desktop with **Chrome** or **Firefox** (do not test in Safari unless asked — known iOS quirks).
- Phone-A and Phone-B both able to receive SMS in real time. Phones should be **physically with you**, not on a desk in another room — you need to read SMS as it arrives.
- A notebook or shared doc for logging bugs (see section 9 for bug template).

### What to do before each test session

1. Open three browser tabs side-by-side:
   - **Tab 1**: portal — will become Parent A's view
   - **Tab 2**: portal — will become Parent B's view (use Incognito so logins don't conflict)
   - **Tab 3**: portal — will become Moderator's view (Incognito)

2. Sign out of any previous sessions.

3. Have a stopwatch ready — some checks involve "within ~3 seconds".

---

## 7. Test scripts (sequential)

Each section is numbered. Tick the checkbox `[ ]` → `[x]` as you complete a step. If a step fails, **stop the section**, log the bug (section 9), and continue with the next section.

> **Critical rule**: do every step **in order**. Earlier steps create the state (accounts, channels, messages) that later steps depend on.

### Section A — User signup & first channel (M1, M4)

- [ ] **A.1** In **Tab 1**, visit `/signup`. Enter Phone-A, your email, click "Send code".
- [ ] **A.2** Phone-A receives an OTP SMS within ~5 seconds. Enter the code on the verify page.
- [ ] **A.3** You are redirected to `/dashboard`. The page shows **no channels** ("Create your first channel" CTA).
- [ ] **A.4** Click "Add channel". Enter co-parent details (Phone-B + email + co-parent's name).
- [ ] **A.5** You are taken to Stripe checkout. Enter test card `4242 4242 4242 4242`, exp `12/30`, CVC `123`.
- [ ] **A.6** After Stripe redirects back, the dashboard shows **one channel**, state `active`.
- [ ] **A.7** Phone-B receives an A2 invitation SMS within ~10 seconds.

**Expected outcome**: Channel exists, both phones know about it, Parent A is logged in.

---

### Section B — Co-parent accepts invite (M1, M4)

- [ ] **B.1** Open the invite link from the A2 SMS on **Tab 2** (Incognito).
- [ ] **B.2** Complete the signup flow — enter Phone-B, email, name.
- [ ] **B.3** OTP SMS arrives on Phone-B. Enter code.
- [ ] **B.4** Land on dashboard. The channel created by Parent A is visible.

**Expected outcome**: Both users have portal accounts; channel is now visible to both.

---

### Section C — Calm SMS, happy path (M2, M3)

- [ ] **C.1** **Phone-A**: text the Clancha number with: `Hi, can you bring the bag tomorrow at 5pm?`
- [ ] **C.2** **Phone-B**: within ~5 seconds, receive an SMS that starts with the **A1 introduction** (because this is the very first message on the channel). Then a second SMS with the actual content: `Hi, can you bring the bag tomorrow at 5pm?` (unchanged).
- [ ] **C.3** **Tab 1** /channel/[id]: the message bubble shows the text with a small grey pill underneath: **"No changes applied"**.

**Expected outcome**: Message delivered verbatim. A1 fires only on the first message.

> **Note**: From now on, A1 will *not* fire again on this channel.

---

### Section D — Rewrite softens tone (M3)

- [ ] **D.1** **Phone-A**: text the Clancha number: `You never help with homework. It's typical.`
- [ ] **D.2** **Phone-B**: receive the softened version, e.g. `I feel you don't help often with homework.` (exact wording may vary, but the meaning is preserved and the sarcastic edge is removed).
- [ ] **D.3** **Tab 1**: the bubble shows **two text blocks** — an "Original" header with the rude version, and a "Revision" header with the softened version. The sender sees both. The receiver only sees the softened version.

**Expected outcome**: Sarcasm neutralised, recipient sees polite version, sender sees both.

---

### Section E — Bare abuse is blocked (M3, A5 system message)

- [ ] **E.1** **Phone-A**: text the Clancha number: `Fuck off.`
- [ ] **E.2** **Phone-A**: receive an A5 SMS within ~3 seconds: *"Clancha: This message wasn't sent as it may breach Clancha's terms. No action is needed. You can continue messaging as normal."*
- [ ] **E.3** **Phone-B**: receive **nothing**.
- [ ] **E.4** **Tab 1**: the bubble shows the message with a **red "Blocked" pill** underneath.
- [ ] **E.5** Repeat with: `You're a worthless piece of shit.`
- [ ] **E.6** Same outcome: A5 to sender, nothing to recipient, red "Blocked" pill.

**Expected outcome**: Both pure-abuse messages block immediately, sender sees explanation, recipient is shielded.

---

### Section F — Mixed-intent messages are held for moderation (M2, M3)

- [ ] **F.1** **Phone-A**: text the Clancha number: `Fuck off, I am picking Arthur up at 6pm.`
- [ ] **F.2** **Phone-A**: receive a Held SMS within ~5 seconds: *"Clancha: Your message is queued for moderator review…"*
- [ ] **F.3** **Phone-B**: receive **nothing**.
- [ ] **F.4** **Tab 1**: bubble shows the message with an **amber "Pending review" pill**.

**Expected outcome**: Mixed content (abuse + a real proposition) is held, not delivered, not blocked.

> **Why this is held, not blocked**: The dismissal can't be safely softened ("fuck off" has no polite paraphrase that preserves intent), but there's a real logistical fact ("picking Arthur up at 6pm") that needs to be communicated. A human decides whether to release it.

---

### Section G — Moderator workflows (M2)

Switch to **Tab 3** (Moderator's view, Incognito).

- [ ] **G.1** Visit `/login`, enter the Moderator's phone number, complete OTP.
- [ ] **G.2** Navigate to `/pending-review`. The message from Section F appears in the queue, with the original text visible.
- [ ] **G.3** Click **Approve**.
- [ ] **G.4** **Phone-B**: receive the message.
- [ ] **G.5** **Tab 1** (do NOT refresh): within ~3 seconds the pill flips from "Pending review" to **"No changes applied"** automatically.
- [ ] **G.6** **Tab 3**: the item has disappeared from the queue.

**Now test Deny:**
- [ ] **G.7** **Phone-A**: text `Oh fuck you Helen. I'm picking up at 5.`
- [ ] **G.8** **Tab 3**: new item appears in queue. Click **Deny**.
- [ ] **G.9** **Phone-B**: receive **nothing**.
- [ ] **G.10** **Phone-A**: receive denial SMS.
- [ ] **G.11** **Tab 1**: pill flips from "Pending review" to **"Blocked"** within ~3 seconds.

**Now test Retry rewrite:**
- [ ] **G.12** **Phone-A**: text another mixed-intent message that will hold (e.g. `Piss off, can you collect Arthur at 5?`).
- [ ] **G.13** **Tab 3**: new item in queue. Click **Retry rewrite**.
- [ ] **G.14** A toast appears: "Rewrite regenerated". **No error popup**. The card shows a new rewrite suggestion.
- [ ] **G.15** Click **Approve** on the new rewrite.
- [ ] **G.16** Phone-B receives the new rewritten version.

**Expected outcome**: All three moderator actions work without errors; sender's portal pill updates dynamically.

---

### Section H — Receiving hours (quiet hours)

- [ ] **H.1** **Tab 2** (Parent B's view) /settings: scroll to "Receiving hours". Set start `09:00`, end `18:00`. Save. Phone-B should receive A4 confirmation SMS.
- [ ] **H.2** If current time is **outside** that window, skip to H.3. If inside, temporarily change the window to a time outside now (e.g. `02:00–04:00`).
- [ ] **H.3** **Phone-A**: text `Quick question — Arthur's coat`.
- [ ] **H.4** **Phone-A**: receive a queued-for-delivery notification SMS.
- [ ] **H.5** **Phone-B**: receive **nothing**.
- [ ] **H.6** **Tab 1**: bubble shows the message with a **blue "Queued — sends in receiving hours" pill**.
- [ ] **H.7** Change Phone-B's receiving hours to include now. Wait up to ~1 minute for the cron to release queued messages.
- [ ] **H.8** Phone-B receives the message; Tab 1 pill flips to "No changes applied".

**Expected outcome**: Quiet hours respected, messages queued and auto-released.

---

### Section I — Emergency keyword bypass

- [ ] **I.1** **Tab 2** /settings: enable "Allow emergency override for incoming messages". Save.
- [ ] **I.2** Make sure Phone-B is currently outside their receiving hours window.
- [ ] **I.3** **Phone-A**: text `its emergency message — Arthur's at hospital`.
- [ ] **I.4** **Phone-B**: receives **immediately**, bypassing the queue.
- [ ] **I.5** **Tab 1**: bubble shows delivered, no queued pill.

**Expected outcome**: Emergency keyword bypasses quiet hours **only when recipient has enabled the feature**.

- [ ] **I.6** Disable emergency override on Phone-B's settings. Repeat I.3. Phone-B should NOT receive immediately; the message should queue.

---

### Section J — Picture sharing (£4.99 add-on)

- [ ] **J.1** **Tab 1** /channel/[id]/settings: toggle "Enable Picture Sharing". Stripe should add the £4.99/month line item.
- [ ] **J.2** Wait for the page to confirm the add-on is active.
- [ ] **J.3** **Tab 1** /channel: a camera icon appears next to the message input. Tap it. Upload a clearly innocuous image (e.g. a photo of a flower).
- [ ] **J.4** Bubble shows a "Moderating…" overlay on the image.
- [ ] **J.5** **Tab 3** (Moderator): `/pending-review` shows the image. Click **Approve**.
- [ ] **J.6** **Phone-B**: receive A8 SMS with a link to view the image in the portal.
- [ ] **J.7** **Tab 1** /channel: image is now visible inline (no overlay). Click "Pictures" tab — image is there too.
- [ ] **J.8** **Tab 2**: open the channel, image is visible.

**Now test denial:**
- [ ] **J.9** Upload a clearly unsafe image (e.g. anything from your harmful-content test set).
- [ ] **J.10** Either AI auto-denies (red "Unsafe / Denied by AI" stamp on the image in Tab 1) OR moderator denies it via Tab 3.
- [ ] **J.11** **Phone-A**: receive A9 SMS.
- [ ] **J.12** **Phone-B / Tab 2**: image is **never visible**.

**Expected outcome**: AI + human moderation gate every image; denied images never reach recipient; sender always notified.

---

### Section K — Viewer mode

- [ ] **K.1** **Tab 1** /channel/[id]/settings: scroll to "Viewers". Click "Invite viewer". Enter Phone-C and email. Set visibility to "Rewrites only".
- [ ] **K.2** Phone-C receives an email/SMS invite.
- [ ] **K.3** Phone-A and Phone-B both receive A11 system SMS.
- [ ] **K.4** In a fourth Incognito tab, open the invite link from Phone-C's email. Complete viewer signup with Phone-C (OTP flow).
- [ ] **K.5** Land on the viewer dashboard. Open the channel. The chat shows **only rewrites**, not originals — for the messages in section D (where the original differed from the rewrite), the viewer sees only the polite version.
- [ ] **K.6** Verify the viewer **cannot** send a message (no input box visible) and **cannot** access `/pending-review` (returns 403 or redirects to dashboard).
- [ ] **K.7** **Tab 1** /channel/[id]/settings: click "Revoke" on Viewer C.
- [ ] **K.8** Refresh Phone-C's viewer tab. They are immediately denied access to the channel.

**Expected outcome**: Viewer sees rewrites only, cannot send/upload/moderate, can be revoked instantly.

---

### Section L — Q&A factual search

- [ ] **L.1** **Tab 1** /channel/[id]/qa: ask `When was Arthur's pickup mentioned?`
- [ ] **L.2** The system returns a factual answer pointing to specific messages from sections C, F, G, J (the ones that mention Arthur or pickup).
- [ ] **L.3** Ask `Should I be angry with Helen?`
- [ ] **L.4** System refuses or returns no advice — does NOT provide opinions or behavioural analysis.
- [ ] **L.5** Ask `What did you say to Helen yesterday?` — should return factual list of messages, not summaries.

**Expected outcome**: Q&A answers factual questions only. No advice, no summaries, no behavioural interpretation.

---

### Section M — Admin functions

Open a **separate browser** or fully sign out of the other tabs, then visit `/admin/login`. Use the admin username + password from your setup table.

- [ ] **M.1** Land on admin dashboard. Navigate to "Channels".
- [ ] **M.2** Click into the test channel. Verify visible:
  - Both parents' names, emails, phone numbers (masked or full per spec)
  - Linked children (if you added any)
  - Subscription state, billing date, last payment status
  - Both users' receiving hours
- [ ] **M.3** Click **Suspend**. Channel state changes to view-only.
- [ ] **M.4** **Phone-A**: try to send any SMS. Receive an A10 SMS instead of normal delivery.
- [ ] **M.5** Click **Reactivate**. Channel returns to active. Sending works again.
- [ ] **M.6** Click **Cancel**. The channel goes view-only at period end (you'll see a "cancels on …" notice).
- [ ] **M.7** Navigate to "Audit log" (or `/activity`). Verify you can filter by:
  - Date range (UK `DD/MM/YYYY` format)
  - Channel
  - Actor (user/moderator/admin)
  - Action type (e.g. `message_blocked`, `message_held`, `message_delivered`)
- [ ] **M.8** Click `message_blocked` filter. Confirm sections E and G.8's blocked rows appear.
- [ ] **M.9** Click `message_held` filter. Confirm sections F, G.7, G.12's rows appear with classification + violationTags.
- [ ] **M.10** Navigate to "Settings → Phone numbers". Confirm 5 UK numbers visible, status of each (active/in-use/free).

**Expected outcome**: Admin can fully manage channels, see billing detail, audit any action.

---

### Section N — Phone calls (A12)

- [ ] **N.1** From any phone, dial the Clancha number you've been texting.
- [ ] **N.2** Hear an automated message (A12) that says something like *"Clancha is a text-only service…"*.
- [ ] **N.3** Call ends. No voicemail prompt. No recording.

**Expected outcome**: Inbound calls play A12 and hang up. The number never accepts voice.

---

### Section O — Subscription cancellation (M4)

- [ ] **O.1** **Tab 1** /settings. Scroll to "Subscription". Click "Cancel subscription".
- [ ] **O.2** Confirm. UI shows "Cancels on [date]" — should be the end of the current billing period.
- [ ] **O.3** Channel state remains active until that date.
- [ ] **O.4** (Optional / requires waiting or admin intervention) On cancellation date, channel transitions to view-only. The "Restart channel" button appears.
- [ ] **O.5** Click "Restart" / re-subscribe via Stripe. Channel returns to active.

**Expected outcome**: Cancellation respects the billing cycle; users can restart at any time.

---

## 8. Things to watch for during every test

These apply to **every section** — keep an eye out:

**✅ Green flags (good — note if anything's off)**:
- Sender bubble pill always matches the actual state shown in the admin Activity log.
- Pill updates **automatically within ~3 seconds** when a moderator approves/denies — no refresh needed.
- A5 SMS arrives within ~3 seconds of sending abuse.
- A1 fires **only on the first message** ever delivered on a channel.
- Recipient **never** sees the sender's original wording (only rewrites).

**🔴 Red flags (log immediately and stop the section)**:
- Any uncaught error or 500 status visible in the UI.
- Any LLM call taking more than ~10 seconds.
- A system message in chat that doesn't start with "CLANCHA".
- An image marked unsafe somehow visible to the recipient.
- A bubble showing "No changes applied" when the message was actually blocked or held.
- The recipient seeing a message that the moderator denied.

---

## 9. How to log bugs

For every bug you find, fill in this template:

```
**Title**: <one-line summary>
**Section**: <e.g. F.2 or J.10>
**Severity**: Critical / High / Medium / Low
  - Critical = safety breach (recipient sees abuse, message bypasses moderation, etc.)
  - High     = wrong UI state, moderator can't perform action
  - Medium   = cosmetic but visible
  - Low      = polish / typo
**Steps to reproduce**:
  1. ...
  2. ...
**Expected**: <what the guide says should happen>
**Actual**: <what really happened>
**Browser**: <Chrome 120 / Firefox 119 / etc>
**Phone OS**: <iPhone 15 iOS 17 / Pixel 8 Android 14>
**Time of occurrence**: <2026-05-19 14:32 BST>
**Screenshot / SMS screenshot**: <attach>
**Console errors (open DevTools → Console)**: <paste any red lines>
```

Submit each bug as a separate ticket (or message to your team lead, depending on the team's workflow).

---

## 10. Troubleshooting / FAQ

**"OTP SMS didn't arrive."**
Wait up to 60 seconds. Check that the phone has signal. If still nothing after 90 seconds, log a bug. **Do not** spam the resend button — it can rate-limit you.

**"I sent a message but the portal shows nothing yet."**
The portal polls every 500ms but the message has to go through Twilio first (1–3 seconds typically). Wait ~5 seconds before assuming a bug.

**"The 'Original' / 'Revision' blocks didn't show up."**
That's correct *if* the rewriter judged the original was already polite and made no changes. The bubble will show just the message with "No changes applied".

**"I clicked Approve on a held image but nothing happened to the bubble."**
Check that the page is the channel page (Tab 1), not the queue (Tab 3). The bubble lives on the channel page. The queue page updates instantly on the moderator's side; the channel page updates within ~3 seconds.

**"The 'Pending review' pill never flipped."**
First check whether the moderator's action succeeded (Tab 3 — did the item disappear from queue?). If yes, wait up to 4 seconds. If no flip after 4s, log a bug.

**"My Stripe card was rejected."**
Use exactly `4242 4242 4242 4242` (no spaces problematic? try with spaces too). Any future expiry. Any 3-digit CVC. Any postcode. Real cards won't work on staging.

**"I'm locked out — too many OTP attempts."**
The system rate-limits OTP requests. Wait 5 minutes, or ask an admin to reset.

**"Logged in as moderator but `/pending-review` shows 403 / redirects."**
You may have logged in with the wrong account. Sign out, sign in again with the moderator's phone, not a regular user phone.

**"What's the difference between 'held' and 'blocked' for the sender?"**
- **Held** → sender's portal shows amber pill, sender gets an SMS saying "queued for moderator review", recipient gets nothing yet. May become delivered or blocked later.
- **Blocked** → sender's portal shows red pill, sender gets A5 SMS saying "this message wasn't sent", recipient gets nothing, terminal state.

---

## 11. Reference — message states

You may see these state values in the admin Activity log:

| State | Meaning | Final? |
|---|---|---|
| `received` | Twilio webhook received the SMS, processing hasn't started yet | No (transient) |
| `queued` | Outside recipient's receiving hours; will be released later | No |
| `rewriting` / `processing` | LLM is classifying / rewriting | No (transient) |
| `held` | Classifier said `uncertain`; awaiting moderator | No (becomes `delivered` or `blocked`) |
| `delivered` | Sent successfully to recipient via Twilio | Yes |
| `blocked` | Classifier said `unsafe`; never delivered | Yes |

Sender-side portal pills map to these states as follows:

| Pill | State |
|---|---|
| "No changes applied" (grey) | `delivered` with no rewriting (or rewriter said the original was fine) |
| Original / Revision blocks | `delivered` after rewriting |
| Amber "Pending review" | `held`, `rewriting`, `processing`, `received` |
| Red "Blocked" | `blocked` |
| Blue "Queued — sends in receiving hours" | `queued` |

---

## 12. Reference — system message wording

If you want to verify A1–A12 wording matches spec, the exact text lives in `lib/messaging/appendixA.ts`. The key one to check during testing is A5 (blocked):

> "Clancha: This message wasn't sent as it may breach Clancha's terms. No action is needed. You can continue messaging as normal."

If you see *any* system message that doesn't start with **"Clancha:"** (colon prefix — the en-dash was retired in July 2026 for SMS-encoding cost), that's a bug — log it under severity Medium.

---

## 13. End of test — wrap-up checklist

When you've finished a full pass:

- [ ] All bugs logged with severity and reproduction steps.
- [ ] Sign out of all browser tabs.
- [ ] Note any tests you skipped and why (e.g. "Section O step 4 — requires waiting until billing period end").
- [ ] Note any flaky behaviour (e.g. "Section G.5 pill flipped after 5s, not 3s — happened twice in five attempts").
- [ ] Report total test time and any blocking issues to your team lead.

---

**Questions while testing?** Ping your team lead. Don't guess at expected behaviour — the spec is the source of truth and this document references it.

**Last updated**: 2026-05-19
**Document version**: 1.0
