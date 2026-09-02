# Deployment

This is the smallest useful runbook for the pieces implemented so far. It will grow as more of
deployment readiness is implemented; it does not attempt to be a full infrastructure guide yet.

## Bootstrapping the first Platform Admin

There is no PLATFORM_ADMIN signup endpoint, by design. A fresh environment's database has zero
users, so the very first Platform Admin has to be created out-of-band, once, by an operator.

`pnpm --filter @edvora/api admin:bootstrap` (`apps/api/scripts/bootstrap-platform-admin.ts`) does
this. Order of operations for a fresh environment:

1. Run `prisma migrate deploy` against the target `DATABASE_URL` first. The bootstrap tool does
   not run or wait for migrations - it expects the schema to already be in place.
2. Set `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` and `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` in that
   environment (see `apps/api/.env.example`), alongside the API's normal `DATABASE_URL` and
   `AUTH_JWT_*` variables (the tool hashes the bootstrap password with the exact same argon2id
   configuration the API itself uses, so it needs the same auth runtime config to do that).
3. Run `pnpm --filter @edvora/api admin:bootstrap` once, e.g. via `railway run pnpm --filter
   @edvora/api admin:bootstrap` against the target service's environment.
4. **Unset/remove `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` and `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD` again
   immediately afterward.** They are not normal runtime configuration and the running API never
   reads them; leaving them configured only leaves a plaintext password sitting in the
   environment unnecessarily.

Behavior worth knowing before running it:

- **Not automatic.** This never runs on API startup, during `prisma migrate deploy`, or from any
  `build`/`start`/`install` script - it is only ever invoked by an operator, by hand.
- **Only one initial admin.** If a Platform Admin already exists with a different email, the tool
  refuses to create a second one. Adding further platform admins later is a deliberate
  administrative action this tool does not perform.
- **Reruns do not rotate credentials.** If a Platform Admin already exists with the *same*
  (normalized) email you provide, the tool no-ops - it does not touch that admin's password. To
  change an existing admin's password, use the normal authenticated password-change/reset flow,
  not this tool.
- Output on success is intentionally minimal (e.g. "Platform admin bootstrap completed: a new
  platform admin was created.") and failure output is sanitized - neither ever prints the
  password, its hash, `DATABASE_URL`, or any token.

See `apps/api/src/bootstrap/platform-admin-bootstrap.ts` for the full behavior contract
(including the documented, un-fixed limitation that this is enforced by an advisory lock at the
application layer, not a database-level constraint) and its tests for verified scenarios.
