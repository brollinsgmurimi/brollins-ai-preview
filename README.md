# Bro-llins AI

Independent AI workspace with the original navy-and-gold interface, a Cloudflare Worker API and D1 persistence.

## Current status

- The original single-page workspace design is retained.
- The development branch contains the account, invitation and cloud conversation foundation.
- Automated checks validate browser JavaScript, Worker JavaScript and the D1 schema.
- A Cloudflare account, D1 database and deployment secrets are still required before live sign-in and AI inference can work.
- Projects, research notes and knowledge-library notes remain browser-local in this milestone.

## Development

See [DEPLOYMENT.md](DEPLOYMENT.md) for free-only Cloudflare setup, required GitHub Actions secrets, and deployment steps.

The project does not use AppDeploy. It does not automatically upgrade to paid services or fall back to paid AI providers.
