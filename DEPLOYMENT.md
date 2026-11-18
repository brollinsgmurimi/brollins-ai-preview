# Bro-llins AI deployment guide

This project is independent of AppDeploy. The existing navy-and-gold interface is retained; the Worker API and D1 database run separately from GitHub Pages.

## Free-only operating rule

Use a Cloudflare **Workers Free** account. Do not change the account or Worker to a Paid usage plan, add a paid subscription, or enable any paid fallback. If a free quota is reached, the application should stop serving the affected operation until the allowance resets.

Current published free allowances (check the linked official pages before setup because providers can change limits):

- Workers: 100,000 requests per day and 10 ms CPU time per invocation.
- Workers AI: 10,000 Neurons per day. The configured `@cf/zai-org/glm-4.7-flash` model is listed as available on Workers Free.
- D1: 5 million rows read per day, 100,000 rows written per day, 5 GB total account storage, up to 10 databases and 500 MB per database.
- Free daily limits reset at 00:00 UTC. Exceeding a Free allowance causes requests to fail; do not upgrade to Paid to make them work.

Official references:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/

## Cloudflare setup (one-time account-owner action)

1. Sign in to Cloudflare and confirm the account is on the **Workers Free** plan.
2. Create a D1 database named `bro-llins-ai`.
3. Copy its database ID into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
4. Keep the `[ai]` binding enabled. Do not select a Paid usage model.
5. Configure the Worker secret `BOOTSTRAP_SECRET` with a long, randomly generated value. Never commit this value to GitHub.
6. Set `ALLOWED_ORIGINS` to the exact frontend origin. For the current Pages site this is `https://brollinsgmurimi.github.io`.
7. Add these GitHub Actions repository secrets under Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN` (scoped to this Cloudflare account with Workers Scripts Edit and D1 Edit permissions)
   - `CLOUDFLARE_ACCOUNT_ID`
   - `D1_DATABASE_ID`
   - `BOOTSTRAP_SECRET` (a long random value that you keep private)
8. Add the secrets before releasing the development branch. The API deployment workflow runs automatically when the reviewed changes are merged into `main`; it can also be rerun from Actions. The existing Pages workflow publishes the frontend, while the API workflow applies the D1 migration, sets the bootstrap secret and deploys the Worker.
9. Open the Worker URL printed in the API deployment log and check `/api/health`. It should return JSON with `ok: true` and `ai_configured: true`.
10. In Bro-llins AI Settings, enter the Worker URL and test the connection.
11. Choose **First-time owner setup** to create the owner account. The bootstrap secret must match the Worker secret. After the first owner is created, bootstrap is permanently closed.
12. Sign in as owner and create invitations from Settings.

The owner setup secret and account password must never be shared in chat, committed to Git, or placed in frontend JavaScript. Store them in a password manager.

## GitHub Pages

The frontend remains hosted independently on GitHub Pages. The existing Pages workflow is retained. The backend must be deployed before the updated frontend can sign in.

## What the first backend milestone supports

- Owner bootstrap (one time), sign-in, invitation-only registration and sign-out.
- Hashed passwords and opaque server-side sessions.
- Per-user conversation ownership and message persistence.
- Free model inference through the Workers AI binding.
- Per-user daily message cap and explicit free-quota failure handling.
- No paid model/provider fallback.

Projects, research notes and knowledge-library items still use the existing browser-local preview storage in this milestone; cloud sync for those areas is a later milestone. Do not describe those items as cloud-backed yet.

## Validation

GitHub Actions checks JavaScript syntax for the browser client and Worker, and executes the D1 migration against SQLite. A successful CI run validates source syntax and schema only; a live sign-in and AI response still require the Cloudflare setup above.
