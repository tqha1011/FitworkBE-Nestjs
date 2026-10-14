# FitWork demo operations

Use a separate PostgreSQL database, Redis, JWT secret and S3 bucket. `DEMO_ENABLED=true` exposes demo creation and session routes. In the dedicated stack keep `DEMO_ONLY=true`: ordinary register/login are hidden and authenticated HTTP/socket access requires a live demo primary account, even when the demo feature is turned off. The normal application keeps both flags false; its searches exclude demo jobs. For compatibility, omitted `DEMO_ONLY` defaults to the value of `DEMO_ENABLED`.

## Deploy

1. Copy `.env.demo.example` to `.env.demo`, replace the database/Redis passwords and JWT secret, and configure the **dedicated** bucket. Set `DATABASE_URL` and `REDIS_URL` consistently with the compose credentials. These services have separate volumes and no published database/Redis ports. The bucket must already exist and allow the frontend HTTPS origin to PUT presigned uploads and GET PDFs.
2. Set `S3_BUCKET_NAME` and `DEMO_ASSET_BUCKET_CONFIRM` to the same dedicated bucket. Provisioning uses the three checked-in `assets/demo/cv/*.pdf` files, refuses to overwrite mismatching existing samples, and exits without printing credentials. Keep `demo/samples/v1/` read-only after provisioning; runtime storage credentials should permit reads there, and upload/delete only under `user/`. Runtime cleanup never deletes the sample prefix.
3. Run `docker compose --env-file .env.demo -f compose.demo.yml up --build -d`. Dependencies enforce **migration → assets → API**. Dedicated migration/assets Docker stages retain Prisma/tsx; the runtime API uses production dependencies and runs as `node`.
4. Serve the FE through HTTPS. Add proxy routes from `docs/demo/nginx.conf.example` for `/api/` and `/socket.io/`, plus the SPA fallback to `/index.html`. `TRUST_PROXY_HOPS=1` assumes one trusted proxy and the API stays bound to localhost; the example proxy replaces client-supplied forwarding headers. Set `CORS_ORIGINS` to the public demo origin. Keep the refresh cookie HttpOnly/Secure/SameSite=Lax.
5. Smoke-test the endpoints using the flow in `frontend-handoff.md`, then publish the frontend link. Set optional Gemini model/key to enable bounded live requests; samples and session creation work without them.

Local alternative: load only `.env.demo` (for example `dotenv` through your process manager), `npx prisma migrate deploy`, `npm run demo:assets`, `npm run build`, `node dist/src/main.js`. Assets provisioning verifies the confirmation variable. Do not run the broad seed command to create shared demo accounts: this module creates every workspace in a transaction.

## Cleanup and budgets

The API checks expiry on every authenticated HTTP request, refresh and socket join; connected sockets expire at their token/session deadline and check revocation at least every 5 seconds. Switch/logout invalidates local sockets immediately. Every 10 minutes cleanup revokes access, disables workspace users and revokes refresh tokens before queue/storage work. It removes non-active BullMQ jobs, waits for active jobs and outstanding upload URLs, deletes user-owned files and then removes business data in FK order. A two-minute database lease prevents overlapping cleaners; crashed workers can be reclaimed. Storage errors retain data for the next sweep. Cleanup is idempotent and preserves reference catalog/sample assets.

The session counter and UTC global/IP daily counters are committed atomically with evaluation preparation. Duplicate pending/processing/completed evaluations reuse their quota reservation; failed retries count again. BullMQ and Gemini each use one attempt for demo calls. Redis restarts cannot reset these counters. Tombstones are retained at least 24 hours for rolling-hour creation accounting; usage counters are pruned only after their windows plus 24 hours.

Signed upload/download URLs are capabilities: reads expire within 15 minutes and the session deadline; uploads within five minutes and the deadline. Revoking a session blocks new access, but an already issued signed URL is usable until its signed expiry. Cleanup waits for outstanding upload URLs to prevent a late PUT recreating a deleted object.

Monitor structured `demo.workspace.created`, `demo.operation.failed`, `demo.cleanup.completed`, `demo.cleanup.failed`, HTTP demo 429 rates and existing Gemini/BullMQ metrics. Additional OTel counters: `fitwork_demo_workspaces_total`, `fitwork_demo_ai_requests_total`, `fitwork_demo_cleanup_total`, with bounded outcome labels. PostgreSQL `demo_session` records show active count, AI usage, cleanup status/attempts and leases. Do not log tokens, raw IPs or CV contents; demo SDK errors are sanitized before queue/trace diagnostics. `DEMO_ENABLED=false` hides demo routes and rejects existing demo JWT/socket claims after restart.

## Verify

```sh
npx prisma format
npx prisma validate
npx prisma generate
npm run lint
npm test -- --runInBand
npm run build

# An empty, separately migrated *_test database and separate Redis are required.
DEMO_TEST_DATABASE_URL=postgresql://.../fitwork_demo_test \
REDIS_URL=redis://127.0.0.1:56389 CACHE_TTL=300000 \
LLM_EVALUATION_KEY=demo-test-key npm run test:demo
```

`test:demo` runs the real Nest app, PostgreSQL transactions, BullMQ workers and Socket.IO clients. Storage and Gemini are controlled test doubles (no external bills). The test database must end in `_test`; setup clears only demo test counters and cleans expired test workspaces. Coverage includes creation rollback, samples passing V2 validation, isolation, role/refresh/socket revocation, quota concurrency/retry/daily scope, uploads, expiry and cleanup retries/concurrency. Actual Gemini requests, S3 CORS/permissions and public HTTPS/FE smoke remain deployment checks.

Print the FE integration contract with `npm run demo:handoff`.
