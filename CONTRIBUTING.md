# Contributing to JalopyBot

Thanks for helping improve JalopyBot. Small, focused pull requests are the
easiest to review and the safest to deploy.

## Before you start

- Use Node.js 20.19+, 22.13+, or 24.x. Node.js 24 LTS is recommended.
- Search existing issues before opening a new one.
- Open an issue before making a large behavioral or architectural change.
- Never commit credentials, Discord identities, runtime databases, logs, or
  scraped production data.
- Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Local setup

```bash
git clone https://github.com/kckirch/Jalopy-Bot.git
cd Jalopy-Bot
npm ci
cp .env.example src/.env
```

Set `VEHICLE_DB_PATH` to an absolute path outside the checkout. Use a
development Discord application and guild when testing bot integrations.

The default test suite uses isolated temporary databases and fixture-based
scrape responses. It must not read or modify a configured production database.

## Making a change

1. Branch from the latest `main`.
2. Keep the branch limited to one concern.
3. Add or update tests for behavior changes.
4. Update documentation and `.env.example` when configuration changes.
5. Run the validation commands below.
6. Open a pull request using the repository template.

Follow the existing CommonJS style and favor clear names over clever
abstractions. Avoid unrelated formatting or dependency changes in the same
pull request.

## Validation

```bash
npm test
npm run test:coverage
npm run lint
npm run check:dead-code
npm run check:dead-code:production
npm audit
```

Coverage currently must remain at or above 82% for lines, 68% for branches,
and 90% for functions. Live scrape checks are opt-in and should use an
isolated database:

```bash
npm run smoke:live -- --engine http
```

## Pull requests

Explain what changed, why it changed, and how you tested it. Call out any
database migration, environment variable, deployment, or Discord command
registration requirement.

By contributing, you agree that your contribution is licensed under the
repository's [ISC License](LICENSE).
