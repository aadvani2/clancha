# Clancha Mobile-First Readiness Audit — 2026-05-12

**Branch audited:** `feature/clancha-milestone2` (uncommitted working tree, base commit `ad39625`).
**Scope:** End-user surface only — User and Viewer roles. Moderator and Admin portals are out of scope for this pass and should get their own audit before mobile sign-off.
**Spec anchor:** Milestone 4 (`milestone.txt` §1 "User Portal" + §11 "Brand & Visual") — *"mobile-first brand-compliant UI"* is an explicit M4 requirement.
**Method:** Read-through of every User/Viewer page and chat/auth component. Findings verified by direct grep before publishing. No browser/device testing yet — see "Next steps" for the device matrix.

> Living document. Update sections in place as fixes land; bump filename date on a fresh full pass.

---

## Scoreboard

| Surface | Status | Headline |
|---|---|---|
| Authed shell (Sidebar + Header) | ✅ | Hamburger drawer + `lg:` breakpoint already correct |
| Dashboard | ✅ | Responsive padding + max-widths in place |
| Channel chat (`/channel/[id]`) | ✅ | `ChatInterface` (dead code) restructured 2026-05-12; live chat is `MessageTimeline` + `UnifiedChatFooter` and was already OK |
| Channel Q&A (`/channel/[id]/qa`) | ✅ | Send button now inherits 44px from primitive bump (2026-05-12) |
| Channel queue (`/channel/[id]/queue`) | ✅ | `ml-[56px]` replaced with flex layout (2026-05-12) |
| Channel settings (`/channel/[id]/settings`) | ✅ | `p-8` → `p-4 sm:p-6 lg:p-8` (2026-05-12) |
| User settings (`/settings`) | ✅ | Camera button bumped to 36px (2026-05-12) |
| Activity log (`/activity`) | ✅ | Filter row now `grid-cols-1 sm:grid-cols-2` (2026-05-12) |
| Auth shell (`AuthLayout`) | ✅ | overflow scoped to `lg:`, brand panel `lg:` only, safe-area inset added (2026-05-12) |
| Login (`/login`) | ✅ | Helper row stacks on mobile; admin link bumped to text-sm (2026-05-12) |
| Verify OTP (`/verify-otp`) | ✅ | Centred OTP card already correct |
| Invite (`/invite/accept`) | ✅ | Centred card already correct |
| Signup (`/signup`) | ✅ | grid-cols + autoComplete + gender font-size all fixed (2026-05-12) |
| Checkout (`/checkout`) | ✅ | Address grids + main `md:`→`lg:` flip fixed (2026-05-12) |
| Subscription (`/subscription`) | ✅ | `flex-col sm:flex-row` already correct |
| Modals (Create channel / Invite viewer) | ✅ | DialogContent primitive now has mobile margin (2026-05-12) |
| Base `DialogContent` primitive | ✅ | `w-[calc(100vw-2rem)] sm:w-full max-w-lg` (2026-05-12) |
| Base `Button` `size="icon"` | ✅ | h-9 w-9 → h-11 w-11 — HIG-compliant (2026-05-12) |
| `PhoneInput` (login + signup) | ✅ | Font-size bumped to 16px → no iOS focus-zoom (2026-05-12) |

**Headline 2026-05-12 PM:** All Critical and High items resolved this session. Remaining work is the **device-test backstop** (add iPhone SE + Pixel viewport configs to `playwright.config.ts` and re-run e2e flows) and a follow-up audit pass on the **moderator + admin surfaces** (out of scope this round).

---

## Tailwind context

- Tailwind v4. Inline theme in `styles/globals.css` via `@theme inline`. **No `tailwind.config.*` file** — breakpoints are v4 defaults: `sm=640`, `md=768`, `lg=1024`, `xl=1280`, `2xl=1536`.
- Target viewports for this pass: **375px (iPhone SE / mini)**, **390px (iPhone 14)**, **768px (iPad portrait)**.
- Reference touch-target floor: **44pt / ~44px** (Apple HIG). Tailwind: `h-11 w-11`.

---

## Critical (breaks core flow on mobile)

### C1. Chat container is locked to 600px

**File:** `components/ChatInterface.tsx:63`
```tsx
<div className="flex flex-col h-[600px] border rounded-lg bg-card shadow-sm">
```
At 375px viewport with the on-screen keyboard up (~300px), the visual viewport collapses to ~340px. A fixed 600px chat container forces page scroll *and* internal scroll, the input bar disappears beneath the keyboard, and the message list cannot reflow.

**Fix:** Drop the fixed height. Make the parent a flex column that fills the available viewport and let the message area take `flex-1 min-h-0` while the input stays auto-height. The page-shell `app/(app)/layout.tsx` already gives a `h-screen` flex column — wire the chat into it instead of constraining inside.

### C2. Activity filter row stays two-column on phones

**File:** `app/(app)/activity/page.tsx:196`
```tsx
<div className="grid grid-cols-2 gap-3">
```
Filter inputs (date range, type, etc.) are forced into ~165px gutters at 375px. Select labels truncate; touch targets become finicky.

**Fix:** `grid grid-cols-1 sm:grid-cols-2 gap-3`.

### C3. Signup form has two `grid-cols-2` blocks ✅ RESOLVED 2026-05-12

**File:** `app/signup/page.tsx:126` and `app/signup/page.tsx:182`

Both blocks now use `grid grid-cols-1 sm:grid-cols-2 gap-4`. Gender + DOB stack on mobile; skeleton mirrors the same responsive grid. Verified.

### C4. Checkout address grid + `md:` flex break

**File:** `app/checkout/page.tsx:200, 308, 330`
```tsx
// L200 — main split
<div className="max-w-4xl w-full ... flex flex-col md:flex-row gap-8 ...">
  <div className="w-full md:w-[40%] space-y-6">…</div>
  <Card className="w-full md:w-[60%] …">…</Card>
</div>
// L308, L330 — address fields
<div className="grid grid-cols-2 gap-4">
```
Two compounding problems. (1) Address `grid-cols-2` squeezes City/State and Postal/Country into ~150px inputs at 375px. (2) The main layout flips to two-column at `md:` (768px) — between 640 and 768px the page is single-column with a 4xl container that the body cannot fill, and on 667px landscape phones the form looks unfinished.

**Fix:** Address rows → `grid grid-cols-1 sm:grid-cols-2`. Main split → `flex-col lg:flex-row`, plus `lg:w-[40%]` / `lg:w-[60%]`.

### C5. `AuthLayout` traps the form behind the iOS keyboard

**File:** `components/auth/AuthLayout.tsx:22`
```tsx
<div className="w-full h-screen min-h-screen flex overflow-hidden">
```
`overflow-hidden` on a full-viewport container is a known iOS Safari bug pattern. When the keyboard opens, the visual viewport shrinks but the document keeps `h-screen`, the form pushes up *and* the body cannot scroll. The submit button on the signup form (5 fields tall) becomes unreachable until the user dismisses the keyboard. Login is just barely tall enough to escape.

**Fix:** Drop `overflow-hidden` and `h-screen min-h-screen`; let the document scroll naturally — `min-h-screen flex flex-col md:flex-row`. Add `pb-[env(safe-area-inset-bottom)]` to the form panel for notched-iPhone home-indicator clearance.

### C6. `AuthLayout` brand panel still shows on iPad portrait

**File:** `components/auth/AuthLayout.tsx:24, 61`
```tsx
<div className="hidden md:block w-1/2 lg:w-[55%] …">       // brand panel
<div className="w-full md:w-1/2 lg:w-[45%] …p-8…">         // form panel
```
At `md:` (768px — iPad portrait) the brand panel takes 50%, leaving the form panel ~384px. Combined with `p-8` (64px) and `max-w-[400px]` cap, the form has ~320px of usable width — *less* than on a 375px phone, where the brand panel is hidden and the form gets the full width minus 64px padding.

**Fix:** `hidden lg:block` for the brand panel. iPad portrait gets the full-width form; only desktops (≥1024px) see the brand.

### C7. `DialogContent` primitive has no mobile margin

**File:** `components/ui/dialog.tsx:39`
```tsx
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg ..."
```
Base classes are `w-full max-w-lg`. On a 375px phone the modal is 375px wide — edge-to-edge against the viewport, no breathing room. `InviteViewerModal` overrides correctly with `w-[calc(100vw-2rem)] sm:max-w-md`; `CreateChannelModal` does not. Fixing the base means every modal in the app inherits the right behaviour.

**Fix:** Update the base `DialogContent` className to `w-[calc(100vw-2rem)] max-w-lg sm:w-full` (or equivalent) and remove redundant per-modal overrides. Verify against `CreateChannelModal.tsx:121` after.

---

## High (degrades core flow)

### H1. `CreateChannelModal` width override drops mobile sizing

**File:** `components/CreateChannelModal.tsx:121`
```tsx
<DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none shadow-2xl rounded-[2rem]">
```
The `sm:` prefix means the 480px cap only kicks in at ≥640px. Below that, mobile inherits the base (which is also broken — see C5). Once C5 is fixed at the primitive, this is moot; otherwise add `w-[calc(100vw-2rem)]` to match `InviteViewerModal:104`.

### H2. Settings avatar camera button is ~24px

**File:** `app/(app)/settings/page.tsx:242–247`
```tsx
<button … className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-primary text-white …">
  {avatarUploading ? <Loader2 className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
</button>
```
`p-1.5` (12px) plus a 14px icon is roughly a 26×26 hit area. Fails the 44pt HIG floor by ~40%.

**Fix:** `p-2.5` and bump icon to `w-4 h-4` for a 36px button minimum; `p-3` + `w-5 h-5` for HIG-compliant 44px.

### H3. Channel header back/search buttons are 36px

**File:** `app/(app)/channel/[id]/page.tsx:155, 164`
```tsx
<Button variant="ghost" size="icon" asChild>      <ArrowLeft className="w-5 h-5" /> </Button>
<Button variant="ghost" size="icon" asChild …>    <Search    className="w-5 h-5" /> </Button>
```
`size="icon"` resolves to `h-9 w-9` per `components/ui/button.tsx:27` — 36px, below HIG.

**Fix:** Either add a new `size="icon-mobile"` variant at `h-11 w-11` and use it across icon-only nav buttons, or bump the existing `icon` variant globally. Recommend the global bump — there is no desktop-density argument that justifies 36px tap targets in a customer app.

### H4. Q&A send button is 40px

**File:** `app/(app)/channel/[id]/qa/page.tsx:210–217`
```tsx
<Button type="submit" size="icon" … className="rounded-full h-10 w-10 shrink-0">
```
40px — borderline. Same fix as H3, or override to `h-11 w-11` here.

### H5. Scroll-to-bottom FAB is 40px

**File:** `components/channel/MessageTimeline.tsx:167–177`
```tsx
<button … className="… w-10 h-10 bg-white …">
  <ChevronDown className="w-5 h-5" />
```
Same 40px gap. `w-12 h-12` (48px) is the right call for a free-floating FAB — it doesn't have label affordance, so make it generous.

### H6. Channel queue text offset is hardcoded

**File:** `app/(app)/channel/[id]/queue/page.tsx:189`
```tsx
<p className="text-sm ml-[56px] text-muted-foreground">
```
The 56px `ml` aligns text under a 44px icon + gap. On 375px this leaves only ~280px for the message snippet, but more importantly it's a magic number that won't follow if the icon size changes.

**Fix:** Replace the magic number with a flex layout — wrap icon + text in `flex gap-3` and remove the explicit `ml`. Side benefit: it stays correct on any width.

### H7. Login helper text + "Login as Admin" link compete for one row

**File:** `app/login/page.tsx:152–159`
```tsx
<div className="flex justify-between items-center">
  <p className="text-xs text-muted-foreground">We'll send a one-time password to this number.</p>
  <Link href="/admin/login" className="text-xs text-primary hover:underline font-medium">
    Login as Admin
  </Link>
</div>
```
At 375px the helper sentence (~280px wide at `text-xs`) plus the right-aligned link can't fit on one row — it either wraps awkwardly or the link gets pushed under the helper. Also `text-xs` (12px) on a tappable link is a touch-target failure (no padding, ~12px tall).

**Fix:** `flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center` to stack on mobile, and bump the admin link to `text-sm py-1` minimum so it has a real hit area.

### H8. Auth `p-8` form-panel padding eats limited mobile width

**File:** `components/auth/AuthLayout.tsx:61`
```tsx
<div className="w-full md:w-1/2 lg:w-[45%] flex flex-col items-center justify-center p-8 …">
```
`p-8` = 32px each side = 64px total. At 375px the form gets 311px; at 320px (older iPhones / Android compact) only 256px. Combined with the H4-style 44px country-code box in PhoneInput, the phone-number input shrinks to ~180px.

**Fix:** `p-4 sm:p-6 lg:p-8`.

### H9. Signup form has no `autoComplete` hints

**File:** `app/signup/page.tsx:150–212`

None of the inputs declare `autoComplete`. Mobile browsers (iOS keychain, Chrome saved info) won't autofill the user's name, email, DOB, or phone — meaning users are typing 5 fields manually on a tiny keyboard. This is a measurable conversion drop on signup forms.

**Fix:** `autoComplete="name"` on Full Name, `email` on email, `bday` on DOB, `tel` on PhoneInput (it may need a wrapping `<input type="tel" autoComplete="tel">` since the lib renders its own input — verify against `react-phone-number-input` docs). Sex/gender has no standard autofill key — leave as-is.

### H10. Native `<input type="date">` on iOS is cramped at half-width ✅ RESOLVED 2026-05-12

Resolved as a side-effect of C3 — DOB now gets full width on mobile.

### H11. PhoneInput input font-size triggers iOS focus-zoom

**File:** `styles/phone-input.css:102`
```css
.PhoneInputInput {
  flex: 1;
  height: 2.75rem;
  …
  font-size: 0.875rem;   /* 14px */
}
```
Safari iOS zooms the visual viewport whenever a user focuses an input with `font-size < 16px` — the page jumps, the user has to pinch out, and on small phones the input often scrolls off-screen during the zoom. Affects **both** login and signup (PhoneInput is on every auth page).

**Fix:** `.PhoneInputInput { font-size: 1rem; }`. Optional desktop tightening: `.PhoneInputInput { font-size: 1rem; } @media (min-width: 768px) { .PhoneInputInput { font-size: 0.875rem; } }`.

### H12. Signup gender `<select>` triggers iOS focus-zoom

**File:** `app/signup/page.tsx:188`
```tsx
<select … className="flex h-11 w-full … text-sm …">
```
Same iOS zoom behaviour — `text-sm` is 14px. Native selects on iOS are subject to the same `< 16px → zoom` rule.

**Fix:** `text-base` (16px). If desktop density matters, `text-base sm:text-sm` keeps mobile safe and tightens at ≥640px.

### H13. Channel settings page uses `p-8`

**File:** `app/(app)/channel/[id]/settings/page.tsx:140`
```tsx
<div className="p-8 max-w-xl mx-auto">
```
32px padding on each side leaves ~311px of usable width at 375px. Form labels and input groups feel claustrophobic.

**Fix:** `p-4 sm:p-8`. Apply the same pattern to any other internal page using flat `p-8`.

---

## Medium (cosmetic / nice-to-have)

### M1. Date-separator sticky offset
**File:** `components/channel/MessageTimeline.tsx:147` — `sticky top-2` with `px-4`. With a tighter mobile header, the badge can collide with header content when scrolling. Consider `top-14 sm:top-2` once the chat shell is restructured per C1.

### M2. Auth heading sizes
Login/signup headings are `text-3xl` (30px). At 320px viewport they crowd the card. Consider `text-2xl sm:text-3xl`. Not critical — most phones are ≥360px.

### M3. Activity badge wrapping
**File:** `app/(app)/activity/page.tsx:300–302` — `inline-flex` badge with `text-[11px]` + icon + label can wrap mid-badge under timestamps on narrow rows. Add `whitespace-nowrap` if it shows up in QA.

### M4. Subscription card breakpoint
**File:** `app/subscription/page.tsx:66` — `sm:flex-row` switches at 640px. On a 480px Android the card looks fine but unbalanced; consider `md:flex-row`.

---

## Already good (verified, no action)

- `app/(app)/layout.tsx` — flex column on `h-screen`, `flex-1 min-w-0` content area.
- `components/layout/Sidebar.tsx` — slide-in drawer with overlay below `lg:`, `w-72 max-w-[85vw]`.
- `components/layout/Header.tsx` — `lg:hidden` hamburger, `hidden sm:block` for non-essential header info.
- `app/(app)/dashboard/page.tsx` — responsive max-widths and `sm:flex-row` rows.
- `components/ui/input.tsx:13` — base `Input` is `h-9` (36px), but auth pages override with `h-11`. Crucially `text-base` (16px) is in the base — **prevents iOS focus-zoom**. Leave as-is.
- `styles/phone-input.css` — `.PhoneInputCountry` and `.PhoneInputInput` both pinned to `h-11` (44px). HIG-compliant. *(Heights are good; the `font-size: 0.875rem` on the input is a separate issue — see H11.)*
- `components/channel/MessageBubble.tsx` — `max-w-[75%]`, no fixed widths.
- `components/channel/MessageInput.tsx` — auto-grow textarea, no fixed heights.
- `components/channel/UnifiedChatFooter.tsx` — flex layout, max-width container.
- `components/channel/InviteViewerModal.tsx` — correct `w-[calc(100vw-2rem)] sm:max-w-md`.
- `app/verify-otp/page.tsx` — centred card with `max-w-[300px]` OTP input.
- `app/invite/accept/page.tsx` — `w-full max-w-md mx-4` card.
- `components/auth/AuthLayout.tsx` — `hidden md:block` hero, mobile gets full-width form.
- `app/page.tsx` — redirect-only.
- `components/ImageUpload.tsx` — no fixed dimensions.
- `app/subscription/page.tsx` — `flex-col sm:flex-row` already in place.

---

## Patterns to standardise

These are reusable rules — applying them at the primitive layer prevents the same bug recurring per-page.

1. **Form grids stack on mobile.** Default to `grid grid-cols-1 sm:grid-cols-2 gap-4` for any two-input row. Ban bare `grid-cols-2` on user-facing forms (lint rule candidate).
2. **Chat surface owns the viewport.** No fixed `h-[…px]` on chat containers. The page shell is already `h-screen` flex; the chat container should be `flex-1 min-h-0` inside it.
3. **Modal width primitive is mobile-safe.** Update `DialogContent` base to `w-[calc(100vw-2rem)] max-w-lg sm:w-full` so callers don't need to remember. Remove per-modal overrides once the base is fixed.
4. **Touch target floor is `h-11 w-11` (44px).** Bump the `Button` `icon` variant from `h-9 w-9` to `h-11 w-11`. Audit every `size="icon"` usage after.
5. **Page padding tiers.** Use `p-4 sm:p-8` (or `px-4 sm:px-6 lg:px-8`) for any container. Bare `p-8` on a content card is too tight at 375px.

---

## Next steps

In priority order, smallest-first so each can ship independently:

1. **Primitive fixes** (one PR): `DialogContent` base, `Button` `icon` variant. Ripples cleanly across the app and removes most touch-target findings without per-page work.
2. **C1: ChatInterface** restructure. Single component, single file. Verify with the existing `MessageInput` already-correct pattern.
3. **C2/C3/C4: Form grids.** Mechanical `grid-cols-1 sm:grid-cols-2` sweep in Activity, Signup, Checkout. Five lines.
4. **H6/H7: Channel-page polish** (queue offset, settings padding).
5. **Medium tier**: bundle into the same PR as #4 if cheap.

**Device matrix to test against** (none of this has been verified in a real browser yet):
- iPhone SE (375 × 667)
- iPhone 14 Pro (393 × 852)
- iPad portrait (768 × 1024)
- Pixel 7 (412 × 915)

Add iPhone SE + Pixel viewport configs to `playwright.config.ts` before sign-off and re-run the existing e2e suite at mobile sizes — that gives a regression backstop for everything in this audit.

**Out of scope (for the next mobile audit pass):**
- Moderator surface (`/pending-review`, `app/moderator/*`)
- Admin surface (`/admin/*` — channels table, moderators table, prompts editor, audit-log filters)
- Brand-compliance / typography polish (separate `docs/brand-audit.md` deliverable owed per `2026-05-06-milestone-audit.md` open item #10).
