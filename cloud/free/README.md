# Cloudflare Free candidate: SQLite Durable Object API

This is an independent deployment candidate. The original D1 Worker and Node/SQLite entrypoints remain available. It preserves the frontend and every account, cloud-resume and administrator API contract.

`free/index.ts` forwards `/api` and `/api/*` requests directly to the SQLite-backed `MyResumeState` object with the fixed name `myresume-global`. The outer Worker does not hash passwords, parse request JSON or buffer API responses. The object executes the original `src/index.ts` business API through a D1-compatible adapter over `ctx.storage.sql`. Static files and large-font streaming use the existing Cloudflare asset stage.

All authentication parameters and limits are retained: public registration, default 10 resumes, administrator bootstrap, login limits, same-origin/CSRF checks, HttpOnly sessions, 512 KiB content, 5 MiB raw photos, 512 KiB SQLite BLOB chunks, atomic quotas and revision/nonce conflict protection. Native SQLite BLOB ArrayBuffers remain binary; the adapter does not create arrays of millions of numbers.

One API request executes at a time. At most eight requests wait, without acquiring body readers; waiting expires within ten seconds and returns JSON 503 with no-store. The active slot remains occupied until its response stream drains or cancels. Request cancellation cancels the owned input reader, and output cleanup releases the slot once. A thirty-second outgoing-stream deadline prevents an abandoned response from holding the slot indefinitely. Static/font requests stay in the outer Worker and do not enter this queue. `blockConcurrencyWhile` is used only for constructor schema initialization.

## Local preparation and validation

```powershell
# Project root
npm run build:cloud
npm run typecheck --prefix cloud
node --import tsx --test cloud/free/sqlite-d1.test.ts

# cloud/
npm run dev:free
npm run dry-run:free
```

The Free config reads `output/cloud-assets` and uses port 8788, matching the current Vite `/api` proxy. Use the explicitly named `dev:free` / `deploy:free` scripts for this candidate; the existing D1 and Node entrypoints remain available separately. `deploy:free` is a future remote deployment command and has not been run.

Set a local ignored `cloud/.dev.vars` origin compatible with the frontend proxy if using browser development. `free/.env.example` leaves the bootstrap token empty: generate a cryptographically random token of at least 32 characters and never use a published placeholder as a valid credential. Bootstrap credentials belong in the ignored local secret file or later Wrangler secret, never source/frontend code.

Custom esbuild test bundles must use `loader: { '.sql': 'text' }`, externalize `cloudflare:workers` and `node:*`, and configure the Durable Object namespace with `useSQLite: true`. Wrangler has the equivalent Text module rule and `new_sqlite_classes` migration. `cloud/test-free/` is owned by the integration test agent.

## Database initialization and transactions

The shared `migrations/0001_accounts_and_resumes.sql` is imported as text. Constructor initialization runs under `ctx.blockConcurrencyWhile`; a migration table records its name and canonical-text SHA256. Existing initialization is not rerun, and changing an already-applied migration fails initialization. Future upgrades must add migration files and explicit version logic instead of overwriting the initial schema.

The adapter consumes cursors before reading row statistics, obtains direct write counts with SQLite `changes()`, and wraps batches in the real `ctx.storage.transactionSync` API. SQL transaction-control strings such as BEGIN/SAVEPOINT are not used because the Durable Objects SQL API does not allow them. Foreign keys are explicitly enabled; Node-specific WAL/busy_timeout pragmas are deliberately absent from managed storage.

## Free-plan qualification

The official Durable Objects limits distinguish their request CPU allowance from the outer Workers Free allowance. This separation is why password computation is placed in the object. The config declares only a SQLite Durable Object, static assets and the existing rate limiter; it has no remote D1/R2 binding and sets no paid CPU limit.

**Local Miniflare/workerd success does not verify production Free eligibility, managed CPU accounting, or actual usage quotas.** Before public deployment, verify the selected Cloudflare account plan, the current Free allowances, and actual remote outer-Worker/DO CPU metrics using this unchanged scrypt profile. Stay on Free if no additional charges are permitted; reaching a Free hard limit may make requests fail. No scripts in this candidate purchase a plan, create remote resources, deploy, or change public DNS.

Primary references:

- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- workerd SQLite pragma allowlist: https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.c%2B%2B
