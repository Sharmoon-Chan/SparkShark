# MyResume on an existing server, without a new hosting subscription

This variant runs the unchanged MyResume account/cloud/admin API on **Node 24** and its built-in `node:sqlite`. It needs no Workers paid plan, remote D1 database, R2, runtime npm dependencies, or external authentication service. Run it on the already-paid Ali server if zero additional recurring cost is required.

The original frontend build is served directly, including the complete 28–30 MB fonts. The Cloudflare-specific lossless font stage is not used. Preserve `https://me.sharmoon.cc.cd`: it keeps existing browser-local resumes accessible while cloud storage is added.

## Build locally

```powershell
# Project root; ordinary build preserves original TTFs
npm run build
npm run build:node --prefix cloud
```

The second command writes the self-contained `output/node-backend` directory: two Node modules, static `public/`, migrations, and configuration documentation. A Node 24 runtime is the only production dependency. The build does not download a runtime, create remote resources, or deploy. Database files are never included in the output bundle.

## Run

Provide the values from `.env.example` through a private environment file or the existing service/container configuration. `DATA_DIR` is an independent writable persistent directory; bundle/static files may be mounted read-only. It must be outside `public/`.

```text
APP_ORIGIN=https://me.sharmoon.cc.cd
LISTEN_HOST=127.0.0.1
PORT=8790
DATA_DIR=/data/myresume
MAX_API_WORKERS=1
```

```sh
node --env-file=/private/myresume.env server.mjs
```

The server only accepts loopback listen addresses. Put the existing Cloudflared/Nginx route in front of `127.0.0.1:8790`, keeping the same public origin for both pages and `/api`. An isolated container may use host networking to retain a loopback-only listener. Do not publish the backend directly on a public interface. Keep the existing applications and their databases separate.

`APP_ORIGIN` defaults to the original domain and may be explicitly set to another exact HTTPS origin for a future deployment/preview. URLs containing credentials, a path, query or fragment are rejected. For local testing, HTTP is allowed only on localhost/127.0.0.1/::1. The backend always checks the configured origin; it never chooses trust based on an incoming Host or Origin header. Username/password, bootstrap, CSRF, session, quota and resume APIs are the same as the Worker implementation. The initial administrator still requires a random `BOOTSTRAP_TOKEN` and one-time bootstrap latch. Use `cloud/scripts/bootstrap-admin.mjs` with the correct public/local origin; remove the token from service configuration after initialization.

## Resource bounds

The default is one API worker thread. Password scrypt retains **N=32768, r=8, p=3**, but executes inside that thread rather than the HTTP main loop. Static files and `/healthz` remain responsive during password hashing. Setting `MAX_API_WORKERS=2` allows at most two simultaneous hashes; larger values are refused. No password-strength reduction is used.

Only 16 requests may wait for an API worker, with a 15-second queue timeout; saturation returns a structured 503. Requests remain paused until a worker is acquired, so the waiting queue cannot hold sixteen full 8 MiB upload buffers. Validated Content-Length uploads allocate their exact body size once and fill it directly; actual received bytes must match the header. Unknown-length uploads retain a bounded strategy with the same 8 MiB cap. Bodies and responses use transferable ArrayBuffers. The API thread consumes a one-chunk request stream without a constructor copy and releases that input backing store after processing; the HTTP thread releases response backing stores only after flushing/closing the response. A lease remains occupied until flushing finishes. Each SQLite connection uses a 4 MiB page cache; worker JS heaps are limited to 128 MiB. These are resource controls, not a promised total-RSS ceiling: verify the actual process/container peak with photo uploads before choosing a 256 MiB limit. Default one worker is appropriate for the currently limited Ali headroom; two workers require measured spare capacity.

The SQLite adapter enables foreign keys, WAL, full synchronous durability and a 5-second busy timeout. Batch operations are real `BEGIN IMMEDIATE` transactions with rollback; nested operations use savepoints. Avatar BLOB chunks bind as raw bytes with correct view offsets and remain Uint8Array bytes when read back, avoiding the memory cost of millions of JavaScript numbers. The shared resume reader already accepts this binary format; external photo JSON remains unchanged. The existing nonce/CAS and atomic quota SQL are reused.

After these buffer-lifetime fixes, the local Node 24.18.0 child-process benchmark with one API worker completed an exact 5 MiB photo upload/download and three consecutive saves at **208.1 MiB OS peak RSS**, below the 240 MiB review budget. Photo contents and versions were verified. This measures the separate backend process, excluding the test client; verify the chosen Ali container/runtime before public deployment.

Migrations are applied at startup once, recording filenames and SHA256. A changed already-applied migration fails startup. Use new migration files for upgrades. Data is kept in `myresume.sqlite` plus WAL/SHM files in the persistent directory. Back up SQLite coherently with a database backup/checkpoint; copying only the main file during active writes can miss WAL transactions.

The HTTP server exposes only `public/`, checks real file paths, rejects traversal/hidden paths, streams static files in 64 KiB chunks, and uses HTML SPA fallback only for extensionless HTML navigation. Missing fonts/assets/PDF resources return 404 even if the client asks for HTML. Private database/environment paths cannot be served as static files.

## Verification

```powershell
npm run typecheck --prefix cloud
npm run test:node --prefix cloud
```

The Node adapter tests use isolated local databases and the generated bundle. They do not access Ali or production data. Existing Worker/Miniflare integration tests remain relevant because all API business logic is shared.
