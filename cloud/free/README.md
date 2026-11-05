# Cloudflare Free: SQLite Durable Object API

This is the primary Free deployment path. An independent [preview](https://myresume-free-preview.cwh20030613.workers.dev) was remotely verified on November 5, 2026, on an account whose dashboard showed Workers Free/US$0. The production Custom Domain `https://sparkshark.sharmoon.cc.cd` is now active over HTTPS, with an initialized administrator and its bootstrap secret removed. The original D1 Worker and Node/SQLite entrypoints remain available, sharing the frontend and every account, cloud-resume and administrator API contract.

The production configuration uses Worker name `sparkshark` and origin `https://sparkshark.sharmoon.cc.cd`. Its exact Custom Domain is declared as:

```toml
workers_dev = false
preview_urls = false

[[routes]]
pattern = "sparkshark.sharmoon.cc.cd"
custom_domain = true
```

Use the bare hostname without `https://` or `/*`. Cloudflare creates the DNS record and certificate for this Custom Domain. The zone must be active and belong to the selected account, and the hostname must not have a conflicting existing CNAME. Do not replace the old `me.sharmoon.cc.cd` record to attach the new hostname. This production Worker uses its own SQLite namespace and rate-limit namespace `1002`; the preview retains its separate data.

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

The Free config reads `output/cloud-assets` and uses port 8788, matching the current Vite `/api` proxy. Use the explicitly named `dev:free`, `dry-run:free` and `deploy:free` scripts for this entrypoint; the existing D1 and Node entrypoints remain available separately. `deploy:free` performs a real remote deployment and reconciles the configured Custom Domain. Preview deployment used a separate Worker name and its exact preview `APP_ORIGIN`; production uses `sparkshark` and its own namespace.

Set a local ignored `cloud/.dev.vars` origin compatible with the frontend proxy if using browser development. `free/.env.example` leaves the bootstrap token empty: generate a cryptographically random token of at least 32 characters and never use a published placeholder as a valid credential. Bootstrap credentials belong in the ignored local secret file or later Wrangler secret, never source/frontend code.

Custom esbuild test bundles must use `loader: { '.sql': 'text' }`, externalize `cloudflare:workers` and `node:*`, and configure the Durable Object namespace with `useSQLite: true`. Wrangler has the equivalent Text module rule and `new_sqlite_classes` migration. The integration suite is in `cloud/test-free/`.

## Database initialization and transactions

The shared `migrations/0001_accounts_and_resumes.sql` is imported as text. Constructor initialization runs under `ctx.blockConcurrencyWhile`; a migration table records its name and canonical-text SHA256. Existing initialization is not rerun, and changing an already-applied migration fails initialization. Future upgrades must add migration files and explicit version logic instead of overwriting the initial schema.

The adapter consumes cursors before reading row statistics, obtains direct write counts with SQLite `changes()`, and wraps batches in the real `ctx.storage.transactionSync` API. SQL transaction-control strings such as BEGIN/SAVEPOINT are not used because the Durable Objects SQL API does not allow them. Foreign keys are explicitly enabled; Node-specific WAL/busy_timeout pragmas are deliberately absent from managed storage.

## Free-plan qualification

The official Durable Objects limits distinguish their request CPU allowance from the outer Workers Free allowance. This separation is why password computation is placed in the object. The config declares only a SQLite Durable Object, static assets and the existing rate limiter; it has no remote D1/R2 binding and sets no paid CPU limit.

The selected account's dashboard and successful preview and production checks establish that the tested operations ran on Workers Free without a plan purchase. Local success alone was not used as that evidence. **Managed Worker/DO CPU metrics and sustained usage quotas have not been measured.** Client-observed request durations include network time and do not establish CPU consumption or long-term capacity. Stay on Free if no additional charges are permitted; reaching a Free hard limit may make requests fail. Local build/dev/dry-run commands do not deploy or purchase a plan. The deployment script explicitly creates or updates a remote Worker and its configured Custom Domain.

## Remote preview verification

On November 5, 2026, 10 verification groups and 68 recorded API/font operations completed with no HTTP 5xx responses. They covered ordinary registration/login/password changes, secure sessions, account isolation, Origin/CSRF rejection, administrator settings, quotas and concurrent final-slot creation. An exact 5,242,880-byte photo survived upload/download with matching SHA256 and logical storage accounting; stale revisions and an over-limit photo were rejected.

Full downloads of the 28,904,336-byte reconstructed round font and 10,595,912-byte ordinary font matched independent local hashes. Browser inspection confirmed anonymous rendering and that the new-resume dialog defaults to local storage; it was cancelled without creating a resume. This browser check does not replace the API tests or constitute a complete production browser acceptance run.

`sparkshark.sharmoon.cc.cd` is a different browser origin from `me.sharmoon.cc.cd`; its local IndexedDB cannot read the old origin. Export JSON at the old origin and import it at the new one, keeping local storage as the default choice. See [domain migration](../../docs/domain-migration.md). Preview data and accounts belong to the separate preview environment.

## Production Custom Domain verification

On November 5, 2026, the HTTPS production domain passed 7 verification groups covering 42 bounded HTTP operations, with no HTTP 5xx. Homepage and SPA routes showed SparkShark; login, ordinary registration, secure sessions, Origin/CSRF rejection, private account isolation, cloud save/read/edit, administrator quota/statistics, exact-5-MiB photo roundtrip and complete font hashes passed. Synthetic documents were deleted, synthetic accounts disabled, and issued test sessions logged out.

The administrator was initialized separately, and the one-time bootstrap secret was removed. Existing domains were not changed. Browser inspection confirmed SparkShark branding and default-local new-resume selection. These checks do not constitute live browser account interaction or PDF-export acceptance, and they do not measure Worker/DO CPU metrics or sustained workloads.

Primary references:

- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Workers Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- workerd SQLite pragma allowlist: https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.c%2B%2B
