# MyResume accounts and cloud storage

For **zero additional hosting cost**, the independent [SQLite Durable Objects Free candidate](free/README.md) and the [Node 24 + SQLite variant](node/README.md) on the existing Ali server both reuse the same API. The Free candidate has been verified locally; actual account eligibility and managed CPU limits still need remote verification before public deployment. Select its explicit `dev:free` / `deploy:free` scripts when evaluating it. The original D1 Worker configuration below remains separate; no paid plan or remote resources have been created.

This Worker serves the dedicated Cloudflare static stage and a same-origin `/api/*` API backed by D1. It does not require Instabox, a permanent VM, PostgreSQL, R2, or email delivery. No remote resources are created by the source files or local development commands.

Open registration is enabled initially. Each new account receives a configurable default quota of **10 cloud resumes**. The administrator can disable/reactivate users, change individual quotas, reset another user's password, switch registration on/off, set the default quota for future accounts, and inspect user/resume counts and stored bytes. Quota changes do not delete resumes; an account above its quota can still update or delete its existing resumes.

The cloud stores only the current editable resume and its referenced avatar. Local Dexie editing and local history remain available. The cloud revision is an optimistic-concurrency token, distinct from the existing local resume revision. Updates and deletes must send `expectedRevision`; conflicts return HTTP 409 and must preserve the local draft.

## Local development

Run these commands from the indicated directories. The root dependency directory is the existing application dependency tree; install cloud tools only inside `cloud/`.

```powershell
# Project root
npm run build:cloud
# In a separate terminal, keep the frontend development server running:
npm run dev -- --port 5178

# cloud/
npm ci --ignore-scripts --no-audit --no-fund
# If .dev.vars does not already exist, copy .dev.vars.example to .dev.vars.
# Set APP_ORIGIN=http://127.0.0.1:5178 and generate a random local BOOTSTRAP_TOKEN (>=32 characters).
npm run db:migrate:local
npm run dev
```

The frontend uses port **5178**, with `/api` proxied to `http://127.0.0.1:8788`. Keep the browser on the frontend origin. The local `.dev.vars` file is ignored by Git; never overwrite an existing secret file when rerunning setup.

Ordinary `npm run build`, Vite development/preview, and the existing Nginx deployment retain complete original TTFs in `dist/fonts`. **Use `npm run build:cloud` before Wrangler dev/deployment**: it first performs the ordinary build, then copies `dist` to fixed `output/cloud-assets`, splits only fonts above 25 MiB into lossless ≤8 MiB binary parts in that stage, verifies reassembly SHA256, and removes the oversized originals only from the stage. The script checks the stage's exact absolute path, fixed name, real path, and containment in workspace/output before clearing it. Source `public` and ordinary `dist` are untouched by preparation.

The staged `cloud-font-parts.json` maps original `/fonts/*.ttf` URLs to SHA256, full byte count, and ordered chunk paths. Worker routing streams parts sequentially at the original URLs, so CSS and browser PDF font loading keep the same URLs and exact glyph data. HEAD and ETag revalidation do not read the parts; missing manifests and unchunked fonts fall back to ordinary static assets. Manifest parsing restricts names, exact part paths, file count, file size, chunk count and JSON size; it cannot be used to fetch arbitrary ASSETS paths.

Initialize one local administrator from an interactive terminal:

```powershell
# cloud/
node scripts/bootstrap-admin.mjs --origin http://127.0.0.1:5178 --api http://127.0.0.1:8788
```

The script prompts for secrets without echoing them. The bootstrap endpoint requires both the correct Origin and `X-Bootstrap-Token`; the D1 latch permits only one successful initialization. Ordinary registration always creates role `user`, including the first registration. Do not put a bootstrap token or password into frontend source, browser storage, source control, or a shell command argument.

```powershell
# cloud/
npm run typecheck

# Project root; tests use an isolated local D1 database
node --import tsx --test cloud/test-integration/api.test.ts
node --import tsx cloud/test-integration/benchmark-auth.ts
node --import tsx --test cloud/test-font-assets.ts
```

Wrangler 4.157.0 currently bundles Miniflare 5.20261103.0-beta. The directly pinned version matches it. The v5 package exposes `convertV4MiniflareOptions` for test fixtures written against v4; using old constructor options directly fails validation. Keep the production compatibility date independent of outdated local tools.

## API contract

Public shared response types are in `src/cloud/types.ts`. Every API response has `Cache-Control: no-store`. Errors have `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Request / result |
| --- | --- | --- |
| GET | `/api/auth/me` | `CloudSession`, including anonymous session and public settings |
| POST | `/api/auth/register` | `{username,password,displayName?}` → `CloudSession` (201) |
| POST | `/api/auth/login` | `{username,password}` → `CloudSession` |
| POST | `/api/auth/logout` | CSRF header → anonymous `CloudSession` |
| POST | `/api/auth/password` | `{currentPassword,password}` → new `CloudSession`; `newPassword` is also accepted |
| GET | `/api/resumes` | `CloudResumeList` |
| POST | `/api/resumes` | `CloudResumeWrite` → `CloudResumeDocument` (201); omit expectedRevision or use 0 |
| GET | `/api/resumes/:id` | `CloudResumeDocument` |
| PUT | `/api/resumes/:id` | `CloudResumeWrite` with `expectedRevision` → `CloudResumeDocument` |
| DELETE | `/api/resumes/:id` | `{expectedRevision}` → `{deleted:true}` |
| GET | `/api/admin/overview` | `CloudAdminOverview` |
| GET | `/api/admin/users?page=1&pageSize=20` | `CloudAdminUsers`; pageSize ≤100 |
| PATCH | `/api/admin/users/:id` | `{status?,resumeQuota?,displayName?}` → `CloudUser` |
| POST | `/api/admin/users/:id/reset-password` | `{password}` → `{reset:true}`; use ordinary password change for oneself |
| PATCH | `/api/admin/settings` | `{registrationOpen?,defaultResumeQuota?}` → `CloudSettings` |
| POST | `/api/admin/bootstrap` | `{username,password,displayName?}` + one-time token → admin `CloudSession` (201) |

All modification requests require the exact configured `Origin`. Authenticated modifications also require the current session's `X-CSRF-Token`. Browser sessions use an HttpOnly, SameSite=Lax cookie; production uses the Secure `__Host-` prefix, and loopback HTTP development uses a separate cookie name. Sessions expire after seven days. Disabling or resetting a user revokes their sessions; password change revokes old sessions and returns a new one. The API never accepts an owner ID or privileged registration fields from the client.

## Storage accounting and limits

- Resume content uses the existing strict resume schema. Its canonical UTF-8 JSON is limited to **512 KiB**.
- The single referenced avatar must be PNG/JPEG, match its reported dimensions and SHA256, and be at most **5 MiB of raw binary**. Unreferenced extra assets are rejected.
- Request JSON is limited to **8 MiB**, including Base64 transfer overhead. The limit is enforced on the stream even without Content-Length.
- D1 stores avatar bytes in **512 KiB BLOB chunks**, not Base64 text. This avoids D1's per-row limit for a 5 MiB photo. Foreign keys cascade deletions through metadata and chunks.
- A resume's reported `byteSize` is canonical content JSON bytes + raw avatar bytes. It excludes PDFs, fonts, local history, Base64 transport overhead, and SQLite indexes/page overhead. Administrator totals use the same logical measurement; actual D1 billing storage will be somewhat larger.

Quota check and creation use one atomic SQL statement. Updates, avatar replacement, and chunks use one D1 transaction, with a random mutation nonce guarding every asset statement. A stale revision cannot replace photos even when its UPDATE affects zero rows. GET retrieves the resume and all photo chunks in one transactional snapshot. A successful write returns its own committed revision and data, avoiding a subsequent concurrent writer's result.

## Password runtime and abuse control

Passwords use scrypt with **N=32768, r=8, p=3**, a fresh 16-byte salt, and a 64-byte derived key; comparison is constant-time. Unknown-account login performs equivalent work. Parameters are encoded in the hash and are not weakened to fit a pricing tier. Auth sessions use 32-byte random tokens; only their SHA256 hashes are stored.

Login and registration are limited before password hashing. An edge Rate Limiting binding restricts IP and username attempts. D1 additionally provides atomic rolling-window limits across locations. Expired rate windows and sessions are cleaned up during relevant requests. Closed registration is checked again inside the SQL insertion so a simultaneous administrator action takes effect.

`node scripts/probe-crypto-runtime.mjs` compares native synchronous and callback-style scrypt with a concurrent simple request. On the local workerd run, both hashes took approximately 199 ms and delayed the simple request to approximately 200 ms. The async callback did not demonstrate work off the runtime thread, so scryptSync is retained. **These local timings are not managed Cloudflare CPU billing; Workers Free compatibility is not confirmed.** Check actual production CPU metrics and the chosen plan before enabling public registration. No paid plan has been purchased by this implementation.

## Production preparation

These are operator steps, not commands already executed by the implementation:

1. Run `npm run build:cloud` and create the intended D1 database in the chosen Cloudflare account.
2. Replace the all-zero database ID in `wrangler.toml`, retaining the binding `DB`.
3. Keep `APP_ORIGIN=https://me.sharmoon.cc.cd` if preserving the existing browser storage origin. Configure the intended domain on this Worker; domain/DNS changes require a controlled cutover.
4. Set a new random `BOOTSTRAP_TOKEN` using Wrangler secrets, apply the migration to that database, and deploy the static build plus Worker.
5. Initialize the administrator using the interactive script against the production origin; then remove `BOOTSTRAP_TOKEN` from production. The database latch also prevents reinitialization.
6. Verify existing local resumes, cloud save/load, per-account isolation, quota and conflict behavior, and browser PDF export before the public cutover.

The checked-in migration is initial schema only. Never reapply it destructively to an existing database, and preserve future migration history and backups when upgrading. No deployment, purchase, public DNS change, or existing production data change is part of local setup.
