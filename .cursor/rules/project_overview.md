
# Clancha V2 – Master Project Reference Document

## 1. Project Overview & Philosophy
Clancha ("Clarity, Not Chaos") is a neutral, SMS-based communication relay platform designed for separated parents and carers. Its primary purpose is conflict prevention, achieved by intercepting messages before delivery and rewriting them only when necessary to reduce emotional escalation. 

**What Clancha is NOT:**
* It is not a chat app, parenting app, mediation service, coaching tool, or behaviour scoring system.
* It never suggests what users should say, provides advice, or replies on behalf of a user.

**Core Principles (Non-Negotiable):**
* Clancha is always neutral.
* Silence is preferable to harm (messages are held or blocked rather than sent raw if unsafe).
* The second user can participate without creating a web portal account (relying entirely on native SMS).

## 2. High-Level Architecture & Tech Stack
The platform enforces a "Server-Side Enforcement Engine" model. The portal is a display and control layer only; all business logic must be enforced server-side.

* **Frontend:** Mobile-first Web Portal (Vercel deployment target).
* **Telephony:** Twilio (handles SMS routing and inbound voice call termination).
* **AI Engine:** OpenAI (handles message rewriting, image safety pre-checks, and stateless Q&A search).
* **Billing:** Stripe (manages core subscriptions and add-ons).
* **Authentication:** OTP (One-Time Password) via SMS. No passwords.

## 3. User Roles & Terminology
The term "Parents" must be avoided in the UI; use **"Users"** to be inclusive of carers and grandparents.
1. **User:** A participant in a Clancha channel. Limited to 5 active channels.
2. **Moderator:** Human reviewer responsible for safeguarding decisions (approving/denying held messages and images).
3. **Admin:** Platform-level operator who manages users, channels, billing states, and global AI prompts.
4. **Third-Party Viewer:** Read-only role (e.g., solicitor, social worker) with granular visibility permissions.

## 4. State Machines (Strict Enforcement)
The system relies on strict state machines that must never be bypassed.

**Channel States:**
* `Trial` (SMS only) $\rightarrow$ `Active` (upon payment) $\rightarrow$ `View-only` (if billing fails/stops) $\rightarrow$ `Closed`.
* *Note: Outbound SMS is blocked if the channel is View-only*.

**Message States:**
* `Received` $\rightarrow$ `Queued` (if outside receiving hours) $\rightarrow$ `Rewritten` $\rightarrow$ `Held` (for moderation) $\rightarrow$ `Blocked` (if unsafe) $\rightarrow$ `Delivered`.

**Image States (Requires Add-on):**
* `Parked` (AI pre-check) $\rightarrow$ `Rejected` (add-on inactive) $\rightarrow$ `Pending` (moderator queue) $\rightarrow$ `Approved` $\rightarrow$ `Denied`.

## 5. Core Features & Use Cases

### 5.1 Onboarding & Authentication
* **Auth:** Users log in using their mobile number and an OTP.
* **Data Capture:** Mandatory email address capture during signup for service communications.
* **Channel Creation Flow:** User A inputs User B's mobile number. If unknown, User A can generate a secure email invite link as a fallback.
* **Default Settings on Signup:** 
  * Tone: *Calm & Clear*.
  * Receiving Hours: *No restrictions*.
  * Emergency Bypass: *Enabled*.

### 5.2 The SMS Pipeline (Enforcement Engine)
Every inbound SMS follows this strict sequential execution:
1. **Identify Channel:** Match sender mobile + Clancha pool number.
2. **Check Billing State:** If `View-only`, block and send a reactivation system SMS.
3. **Check Receiving Hours:** If outside the recipient's configured hours, queue the message and notify the sender.
4. **Check Emergency Eligibility:** If queued, and the recipient has Emergency Bypass enabled, the sender can reply "emergency" to bypass the queue.
5. **Rewrite Logic:** Send to AI to strip escalation triggers while preserving logistics, warmth, and urgency.
6. **Evaluate & Deliver:** Safe $\rightarrow$ Deliver. Unsafe $\rightarrow$ Block. Uncertain $\rightarrow$ Hold for moderation.

### 5.3 Picture Sharing Add-On
* **Gating:** Costs £4.99/month per channel. If inactive, uploads are rejected.
* **Mechanism:** Images are uploaded via the secure web portal **only**. They are never transmitted via SMS/MMS.
* **Pipeline:** Portal Upload $\rightarrow$ AI Safety Scan $\rightarrow$ Human Moderator $\rightarrow$ Approved $\rightarrow$ Recipient notified via SMS to check the portal.

### 5.4 The "Visibility Firewall" (Crucial Constraint)
* **Users** can see their own original messages, their own rewritten messages, and the rewritten messages received from the other user. 
* **Rule:** A user **never** sees the other user's original wording. This rule is absolute.

### 5.5 Third-Party Viewer Access
* **Access:** Viewers are invited per channel via email and have read-only portal access.
* **Fail-Safe Visibility Rule:** By default, viewers see **rewritten messages only**. A viewer *never* sees a user's original wording unless that specific user independently toggles a permission switch granting access. User A cannot grant access to User B's original text.

### 5.6 Q&A Search Tool
* **Function:** A portal-based, chat-style tool allowing users to ask factual questions (e.g., dates, commitments) about their history.
* **Constraints:** Must only search permitted history (rewritten messages + own originals). No behavioral analysis, summaries, or advice. 
* **Statelessness:** Answers are generated on demand and are never stored in the database.

### 5.7 Voice Call Handling
* **Rule:** Clancha does not support voice calls or voicemail.
* **Action:** Inbound calls to a Clancha number must immediately play a specific pre-recorded message (Appendix A12) and terminate.

## 6. Brand Guidelines & UI Rules
* **Typography:** *Poppins* (Light, Regular, Semibold, Bold).
* **Color Palette:** 
  * Deep Green: `#2F4A44`.
  * Peach: `#E8A675`.
  * Off-White: `#F2E8D9`.
  * Dark Grey: `#33383B`.
* **System Messages:** Must always be prefixed with `"Clancha – "` and exact wording must match Appendix A specifications.
* **Moderation UI:** Must be mobile-first, supporting one-handed use, avoiding long forms, and sorting by longest wait time first.

## 7. Development Milestones (V2 Plan)
* **Milestone 1:** Architecture, JWT/OTP Auth, Role Schema, Email Invite Flow, Default Settings.
* **Milestone 2:** Twilio SMS Pipeline, State Machine, Queueing, Emergency Keyword Logic.
* **Milestone 3:** AI Rewrite Engine, "Safe/Unsafe/Uncertain" classification, Picture Sharing pipeline (£4.99 add-on gating).
* **Milestone 4:** Brand-compliant Web Portal UI, Third-Party Viewer access, Stateless Q&A Search Tool.
* **Milestone 5:** E2E QA, UK SMS Compliance, Vercel deployment, Handover.

## 8. Absolute "Never" Constraints
1. The system must **never** reply on behalf of a user.
2. A user must **never** see the other user’s original wording.
3. The AI must **never** provide advice, coaching, or behavioural judgement.
4. Images must **never** bypass billing or moderation.
5. Client-side portal logic must **never** override server-side rules.
6. Failures (e.g., Twilio or OpenAI outages) must **never** be silent; the system must queue/hold safely, never sending raw, unprocessed text.
