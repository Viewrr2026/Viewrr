# Custom retainer cycles V1

New custom-cycle agreements use `workflow_version = 1`. Existing agreements stay on the legacy model; this release does not convert their scope, prices or payment records. The workspace combines Current Cycle and Deliverables while retaining the other navigation sections.

## Local validation

- `npm run test:retainer`: isolated PostgreSQL-compatible database tests plus actual FFmpeg image/video processing. This command does not use DATABASE_URL or real payment credentials. Install FFmpeg and ffprobe to run the media test.
- `npm run build` (or `node --import tsx script/build.ts` in environments restricting the tsx CLI IPC socket).
- `npm run check`: the baseline has existing TypeScript failures. Compare diagnostics against the baseline rather than treating a successful bundle as a type-check pass.

The added test-only PGlite dependency is not imported by application startup or production routes.

## Staging prerequisites — approval required before applying

1. Reconcile the target branch and preserve unrelated working-tree changes.
2. Apply `migrations/0013_custom_retainer_cycles.sql` to the explicitly selected staging database after the earlier retainer migrations. Do not use schema push to replace this migration. It is additive and transactional.
3. Configure the existing object-storage integration with a genuinely private bucket. Verify there is no public bucket URL or public CDN exposing its objects before setting `RETAINER_PRIVATE_STORAGE_CONFIRMED=true`.
4. Install FFmpeg and ffprobe on the server/worker host. Optional executable overrides: `FFMPEG_PATH` and `FFPROBE_PATH`. The media preview worker supports JPEG, PNG, WebP, MP4, MOV and WebM, up to 200 MB, with video limited to 30 minutes. Unsupported/failed previews remain protected.
5. Configure Stripe test keys, a test Connect freelancer with transfers enabled, and the existing signature-verified webhook and retry worker. Check successful, challenged, failed and interrupted checkout with both roles.
6. Set `CUSTOM_RETAINERS_ENABLED=true` to enable new creation and start the preview/deadline worker. `RETAINER_WORKER_ENABLED=true` keeps the worker running independently when new creation is disabled. Keep at least one worker process running for previews and notifications. Server mutation checks enforce deadlines independently of that worker.
7. Configure the existing Resend integration and APP_BASE_URL for the selected environment. Email notices respect payment, stage and invitation preferences. In-app notices use a durable outbox. Test actual delivery; local tests do not send email.
8. Test the stored original and generated preview using two separate accounts, including direct access attempts, paid previous cycles and a frozen subsequent cycle. Verify private-storage access and signed-link expiry in the real environment.
9. Validate refund and dispute operations against the existing payment service. Full-refund payment state prevents new original access; partial refunds retain access. Previously downloaded files cannot be recalled. Refunds do not silently rewrite later cycle schedules. Confirm this treatment against the product’s refund policy before enabling live payments.

No staging or production migration, environment change, deployment or live Stripe operation is performed by this source change.

## Acceptance and deadlines

Sending a version records the proposer’s agreement. The other participant accepts that exact version or requests changes. Pending amendments do not replace accepted terms. Started cycles retain scope and price; date changes need mutual agreement. Approved/paid cycles remain immutable.

Client approval of every required submitted version creates one invoice and starts the payment period. The server computes calendar-day deadlines in Europe/London; weeks are seven days. Verified payment completes the cycle and releases its approved originals. Bank payout arrival remains separate from payment receipt.

Only one subsequent cycle may proceed while the preceding accepted invoice is within terms. Zero-day terms require payment first. Overdue invoices freeze subsequent uploads, submissions and approvals. Existing files, communication, payments and paid-file access remain. Expired planned dates require a mutually accepted schedule amendment; the system never extends a contract automatically.

## Operation and recovery

Preview jobs retain private originals and processing state in PostgreSQL/object storage. Interrupted jobs are reclaimed after their lease expires; failed jobs can be retried from the workspace. Use a dedicated worker process if media volume grows; current concurrency is one encoding job per running application process.

Checkout persists canonical request parameters and uses provider idempotency keys. Card declines and authentication retries reuse the intent; cancellation permits a new attempt after provider confirmation. An unresolved attempt without an intent ID older than 23 hours is held for reconciliation rather than silently recreated. Confirm provider status before taking any manual recovery action.

Disable new creation with `CUSTOM_RETAINERS_ENABLED=false` if necessary, while leaving `RETAINER_WORKER_ENABLED=true` for existing agreements. Preserve the additive schema, media and ledger records. Once custom retainers exist, do not roll back to an older application version that cannot interpret this model without a reviewed compatibility plan. Do not drop the new tables as a routine rollback.

## Remaining release verification

The browser and local tests do not establish live Stripe, private bucket, email, deployment or physical-device behaviour. The existing mobile source excludes retainers from mobile V1. This change does not introduce a native retainer screen, settle Apple payment classification or constitute App Store approval.
