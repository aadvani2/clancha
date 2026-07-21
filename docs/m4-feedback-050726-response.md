# Response to M4 feedback (Craig, 05/07/26)

Point-by-point. Everything marked **Done** is implemented on branch
`fix/m4-feedback-050726` and ready for staging.

---

## 1. SMS and system messages

**1.1 Prefix "Clancha –" → "Clancha:" — Done.** Every automated message now uses
the colon prefix. The en dash was indeed the character tipping every system
message into the expensive encoding.

**1.2 Straighten curly quotes — Done, twice over.** The rewrite engine's output is
normalised (curly quotes/dashes/ellipses → plain equivalents, wording untouched),
and as a belt-and-braces measure the same normalisation now runs on **every**
outbound SMS at the moment it's handed to Twilio. So even a curly apostrophe
typed by a parent on an iPhone (their keyboard inserts them automatically) can no
longer flip a message into the expensive encoding. System templates were audited
too — with the prefix fixed, all are now fully GSM-7-safe.

**1.3 Short links — Done.** The join link in the introduction message went from a
64-character code (`/join?t=<64 chars>`) to an 11-character one (`/j/Ab3xYz9Kq2M`),
on our own domain. Security is unchanged in practice: the code is single-use,
stored only as a hash, and claiming it still requires an SMS code to the invited
parent's own phone. The terms link also now goes via our own short `/terms`
redirect instead of the full marketing-site URL. Old-format links already sent
keep working. One more option when you're ready: we've added a
`SHORT_LINK_BASE_URL` setting — register a short branded domain (say `clan.ch`),
point it at the portal, and every SMS link shrinks further with no code change
and no public shortener.

**1.4 Every automated message verbatim — see `docs/appendix-a-messages.md`.**
Rendered exactly as sent, with character/segment counts per message and notes on
the two worth shortening (A1 at 3 segments, A2 a whisker over 1). Mark up any
wording you want changed and we'll apply it verbatim.

**1.5 Welcome message fires once — Confirmed, and hardened.** It only ever goes to
the invited parent (never the account creator), on their first delivered message.
Until now the "once" guard was a database query ("has this person already had a
delivered message on this channel?") — correct, but with a theoretical race if two
first messages arrived in the same instant. We've added a persistent per-recipient
flag claimed atomically before sending, so a repeat is now impossible by
construction, not just in practice.

**1.6 The sixth (local) number — investigated; isolated from live routing.**
Findings:

- The application's number pool contains exactly the five mobile numbers
  (`+4474…`), confirmed in both code and the live database. The local number is
  not in the pool, is not assigned to any channel, and nothing in the codebase
  references it.
- That means it **cannot receive a customer's message**: inbound routing works by
  matching the receiving number to a channel, and no channel can ever match it.
  Nothing can send from it either.
- What it's *for* we can't see from the application side — it isn't wired to
  anything. Most likely it's an early test purchase or came with the account
  setup. Worth checking the number's purchase date in the Twilio console
  (Phone Numbers → Manage → Active numbers); if it has no purpose there, release
  it and the monthly charge stops. Happy to do this together on a call if useful.

## 2. Portal and onboarding

**2.1 History search — Done.** The open text field is gone. There's now an obvious
**"Ask about your history"** button that opens the search when tapped; the empty
state inside explains what it does and that nothing typed there goes to the other
parent. The overlapping text in the field is fixed (it was a line-height bug when
questions wrapped to two lines). The timeline empty state no longer says "Send
one below." — it now says: *"No messages yet. Text your Clancha number from your
phone's messaging app and the conversation will appear here."*

**2.2 Welcome step — Done, your wording verbatim.** Both parents (creator after
payment, joiner on first login) now see a "Welcome to Clancha" step with your
exact copy **before** the unique-number screen.

**2.3 Number visibility + How Clancha works — Done.** Every channel now shows
"Unique Clancha number: +447…" on the dashboard card and at the top of the
message history. (We've kept the +44 format per your earlier "format phones as
+447 across the board" instruction — shout if you'd rather 07 here.) And there's
a new **"How Clancha works"** section in the portal menu covering: what a channel
is, how to message the other parent, all four moderation outcomes, why a message
might be blocked, receiving hours and how to change them, emergencies, history
search, picture sharing, and viewers. Plain English throughout. If you'd like to
supply or adjust wording, it's one page — send edits and we'll drop them in.
Images/screenshots can be added once the copy has your sign-off.

**2.4 Recipient step — Done, your wording verbatim.** "Enter the other parent's
details here, not your own." now sits at the top of the recipient section, in
both first-channel setup and Create Channel.

**2.5 Channel explanation — Done.** A "What is a channel?" explainer now appears
on sign-up/channel creation, and it's the second section of How Clancha works.

**2.6 Date of birth on Android — Done.** All date-of-birth fields (sign-up and
linked children) are now typed entry — DD/MM/YYYY with the slashes inserted
automatically and a numeric keypad.

**2.7 No customer-facing "AI" — Done.** "AI INSIGHTS" is now "History search";
also swept: the search button/placeholder/loading/failure text, the image-review
copy ("Every image is checked and approved before it's shared"), the
subscription page feature lists, the activity label, and the image "DENIED BY
AI" badge (now "NOT APPROVED"). Internal admin/moderator screens keep their
technical naming, per your note.

**2.8 Receiving hours overlap — Fixed.** The Start/End boxes stack vertically on
phones (the two side-by-side time inputs couldn't physically fit at that width —
they now only sit side-by-side on wider screens).

**2.9 Admin channel list on mobile — Fixed.** This was a layout-engine quirk: the
scroll container sized itself to the longest channel name and pushed everything
off the right edge. Root cause fixed for every scrollable page in the portal,
not just this one.

**2.10 `clancha_…@invited.com` — explained, and tidied.** It's an internal
placeholder, not a real mailbox: when you create a channel to someone who has
never registered, the system needs a unique account record for them before they
accept, so it synthesises `clancha_<their number>@invited.com` until they sign up
and their real email replaces it. It was only ever visible on the **admin**
channel view (regular users never see it), but it looked wrong — that screen now
shows *"No email yet — invite not accepted"* instead.

## 3. Rewrite engine

**Done.** Added an explicit rule (with your Marla example verbatim) to the
rewrite instructions: on hostile-but-salvageable messages, removing the
hostility must not leave a curt remnant — the remainder is rephrased as a
complete, civil sentence, and a *current, logistics-relevant* fact about the
other parent ("you're late") is treated as information to keep, not blame to
delete. The guardrail is restated unchanged in the same rule: keep the sender's
genuine feelings and meaning, remove only the escalation, never strip honest
frustration. Note: this ships as a new default revision, so if you've edited the
rewrite prompt in Admin → Prompts, re-save your version to layer it back on top.

## 4. WhatsApp (view only — nothing being built)

**Is it doable later? Yes, cleanly.** Twilio (our SMS provider) also carries
WhatsApp Business messages through the same API we already use, so the whole
safety pipeline — classification, rewriting, receiving hours, moderation, the
system messages — would work unchanged. It would be a per-channel choice: "this
channel runs on SMS" or "on WhatsApp", with SMS as the fallback.

**How it would work technically.** Our existing Clancha numbers get registered as
WhatsApp senders (a Meta business verification, one-off, 1–2 weeks lead time).
Inbound WhatsApp messages arrive at the same webhook; outbound goes out the same
way, just addressed to WhatsApp instead of SMS. Two WhatsApp-specific rules to
design around: (1) both parents must have WhatsApp and must opt in to receiving
business messages — so it's a choice at channel setup, never a default; (2)
WhatsApp only allows free-form replies within 24 hours of that person's last
message; outside that window we'd send via a pre-approved message template
(one-off approval from Meta, fine for our relay pattern).

**Costs.** Development: roughly 2–3 weeks of work (sender registration, the
per-channel choice + UI, template approval, delivery fallback to SMS, testing) —
happy to firm this up if you want it in a future release. Running costs are the
interesting part: within an active conversation WhatsApp messages carry **no
per-message Meta fee** (just Twilio's ~half-a-penny handling fee), and there's no
per-segment length cost at all — long rewritten messages cost the same as short
ones. Messages outside the 24-hour window are billed by Meta at roughly 2–4p. For
busy channels WhatsApp would likely be *cheaper* than SMS; for sporadic ones,
about the same. So it works as a premium option or as a cost play at scale.

---

*Also fixed while in the area: the SMS sent to a newly-created moderator had a
broken login link (`/login/admin/login`) — now points to the admin login.*
