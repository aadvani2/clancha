# Clancha API – Postman Collection

End-to-end API testing for the Clancha application.

## Setup

1. **Import in Postman**
   - Open Postman → Import → select `Clancha-API.postman_collection.json`
   - Optionally import `Clancha-Local.postman_environment.json` and set it as the active environment

2. **Run the app**
   - `npm run dev` (default: http://localhost:3000)
   - Ensure MongoDB and env vars (e.g. `MONGODB_URI`, `JWT_SECRET`) are set

3. **Variables**
   - `baseUrl`: API base (default `http://localhost:3000`)
   - `phone`: Phone number for auth (E.164, e.g. +447700900000)
   - `code`: OTP from Send OTP. **In dev:** after calling Send OTP, check the **terminal** where `npm run dev` is running – the plain OTP is logged as `[dev] OTP for <phone> -> <code>`. (The DB stores only a hash, so you cannot extract the code from MongoDB.)
   - `email`: Email for signup/verify (required for new users)
   - `token`: Set automatically by the **Verify OTP** request (from response)
   - `channelId`: Set automatically by **Create Channel** (or set from List Channels)

## Recommended flow

1. **Auth** → **Send OTP** (use your `phone`)
2. Get the OTP (SMS, or from DB in dev), set `code` in environment
3. **Auth** → **Verify OTP** (token is saved automatically)
4. **Users** → **Get Me** (confirm auth)
5. **Channels** → **Create Channel** (use another user’s phone; channelId is saved)
6. **Channels** → **Get Channel Messages** / **Messages** → **Send Message**
7. **Q&A** → **Ask Question** (uses same channelId)
8. **Moderator** / **Admin** requests require a user with `moderator` or `admin` role

## Notes

- **Bearer token:** Protected routes accept `Authorization: Bearer <token>`. The collection uses the token saved from Verify OTP.
- **Cron:** Use header `Authorization: Bearer <CRON_SECRET>` if you set `CRON_SECRET` in `.env`.
- **Webhooks:** Twilio/Stripe are called by external services; the Twilio sample is for reference (signature validation will fail without real Twilio payload).
