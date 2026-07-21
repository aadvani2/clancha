# Every automated message, verbatim (M4 feedback 05/07/26, item 1.4)

Rendered exactly as the system sends them **after the July 2026 encoding changes**
("Clancha:" prefix, GSM-7-safe punctuation, short links). Names, times and links are
filled with realistic example values; the placeholder parts are noted per message.

Character counts assume the staging domain (`clancha.stagingenv.app`). A GSM-7 SMS
carries **160 characters in one segment** (153 per segment when concatenated).
All messages below are now GSM-7-safe end to end — a wire-level normaliser also
straightens any stray curly quote or dash before anything reaches Twilio, including
rewritten parent messages.

> **OTP messages:** the login/verification code SMS is produced by Twilio Verify,
> so its wording is configured in the Twilio console (Verify service), not in the
> application. Everything else is below.

---

### A1 — First-contact introduction (sent to the invited parent on their first delivered message) — 371 chars, 3 segments
> Clancha: You've received a message from Sam Brown via Clancha. Clancha helps keep communication calm, clear and focused on the children. You can reply as normal by text. By replying, you agree to Clancha's terms: https://clancha.stagingenv.app/terms. You can also create an online account to manage settings and view history: https://clancha.stagingenv.app/j/Ab3xYz9Kq2M.

Variables: sender's name; the one-time join link (11-character code). If no join
token could be issued the last link is `…/login` instead. Fires **once per
recipient per channel** — enforced by a persistent database flag.

*This is our longest message. If you'd like the wording shortened, mark up this
text and we'll apply it verbatim — at 160/segment, cutting it under 320 chars
saves a segment on every new-channel introduction.*

### A2 — Message queued outside receiving hours (to sender) — 161 chars, 2 segments
> Clancha: This message is queued until 06:00 as requested by Sam. Reply with "emergency" if it's an emergency and, if Sam has this enabled, they will be notified.

Variables: resume time, recipient's name. *One character over a single segment
with these example values — real names usually push it further. Trimming ~10
characters would make it one segment in most cases.*

### A3 — Emergency delivered (to sender) — 84 chars, 1 segment
> Clancha: This message was marked as an emergency and delivered outside normal hours.

### A4 — Emergency denied, no bypass (to sender) — 86 chars, 1 segment
> Clancha: Sam doesn't have Emergency Bypass enabled. The message is queued until 06:00.

### A5 — Message blocked (to sender) — 126 chars, 1 segment
> Clancha: This message wasn't sent as it may breach Clancha's terms. No action is needed. You can continue messaging as normal.

### A6 — MMS attempt, Picture Sharing active (to sender) — 103 chars, 1 segment
> Clancha: Picture Sharing is only available via your online portal: https://clancha.stagingenv.app/login

### A7 — MMS attempt, no Picture Sharing (to sender) — 125 chars, 1 segment
> Clancha: To upload and view images, add the Picture Sharing add-on (£4.99) here: https://clancha.stagingenv.app/subscription.

### A8 — Picture approved (to recipient) — 204 chars, 2 segments (117 chars, 1 segment without the direct image link)
> Clancha: A new picture has been added to the Clancha portal: https://clancha.stagingenv.app/api/images/view/665f1c2ab9d4e6f7a8b9c0d1 (or log in to view full history: https://clancha.stagingenv.app/login).

*The direct image link carries a 24-character id. We can shorten this the same
way as the join link (e.g. `/i/<code>`) if you'd like — say the word.*

### A9 — Picture denied (to sender) — 69 chars, 1 segment
> Clancha: Your picture wasn't shared as it may breach Clancha's terms.

### A10 — Channel view-only, payment stopped — 148 chars, 1 segment
> Clancha: This channel is currently view-only. To continue messaging, reactivate your subscription here: https://clancha.stagingenv.app/subscription.

### A11 — Viewer added — 107 chars, 1 segment
> Clancha: Jo Taylor has been added as a viewer to this channel. You can manage viewer access in your portal.

### A12 — Inbound voice call (spoken, not SMS)
> You've reached Clancha. Clancha is a text-only service, and calls aren't currently supported. Please continue the conversation by text. Thank you.

### A13 — Viewer granted full history — 55 chars, 1 segment
> Clancha: Sam has granted Jo Taylor full history access.

### A14 — Viewer restricted to rewrites — 65 chars, 1 segment
> Clancha: Sam has restricted Jo Taylor to rewritten messages only.

### A15 — Viewer removed — 57 chars, 1 segment
> Clancha: Jo Taylor is no longer a viewer on this channel.

### A16 — Viewer left — 53 chars, 1 segment
> Clancha: Jo Taylor has left this channel as a viewer.

### Held for moderator review (to sender) — 99 chars, 1 segment
> Clancha: Your message is queued for moderator review. You'll be notified when it has been reviewed.

### Moderator account created (to new moderator) — 156 chars, 1 segment
> Clancha: You've been added as a moderator. Log in at https://clancha.stagingenv.app/admin/login with your email and the password your admin shared with you.

### Operational: empty emergency queue (to sender who replied "emergency" with nothing queued) — 30 chars, 1 segment
> No pending messages to deliver

---

**Live-domain note:** on the live domain the links shorten further automatically.
There is also a `SHORT_LINK_BASE_URL` setting — if you register a short branded
domain (e.g. `clan.ch`) and point it at the portal, every SMS link shrinks with
no code change and no public shortener involved.
