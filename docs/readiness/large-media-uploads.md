# Large media uploads

Feed, portfolio, project, cycle and custom-retainer uploads now accept up to 5 GB (5,368,709,120 bytes). Profile images remain capped at 5 MB. Supported formats, the 30-minute video limit, preview validation, watermarks, ownership checks and verified-payment release of private originals remain in place.

## Transfer and recovery

- Browser File.slice and mobile FileHandle send sequential 8 MB chunks through authenticated API requests to R2 multipart storage. Mobile never reads the whole video into a JS Blob. Each failed chunk is retried twice; successful chunks do not need to be sent again during that attempt. Keep the page/app open while uploading. Navigating away can interrupt the attempt; cross-session resume is not implemented.
- The server checks actual stored part sizes and HEAD metadata before publishing. The multipart ID and object key are server-only. Row locks prevent late chunk writes from racing completion. Completion is idempotent and recovers a lost R2 response via HEAD.
- Unfinished uploads expire after 24 hours and are aborted by the media worker. Personal account erasure also triggers multipart cleanup. R2's default incomplete multipart lifecycle is an additional fallback for an interrupted creation before its ID could be persisted.
- Existing single-request endpoints remain available for older builds with their 200 MB request ceiling. New clients use the chunk endpoints. No new storage keys, environment variables, bucket CORS policy or SDK dependency is required.

## Release order

1. Apply `migrations/0018_large_media_uploads.sql` to the selected deployment database before deploying. It widens both size columns to BIGINT and adds nullable multipart metadata. It preserves existing rows and can be applied again. Do not narrow the columns on rollback after large files have been uploaded.
2. Deploy the matching server and web client. Keep the existing private R2 configuration and media worker running.
3. Build the updated mobile app and upload it to TestFlight. Existing TestFlight binaries retain their old client-side size limits.
4. On the deployment, upload a real video above the old 50/200 MB limits, then a video near the 5 GB limit (under 30 minutes). Check progress, preview, playback and original download. Repeat on a physical iPhone; interrupt networking, retry, and cancel an upload. Verify unpaid clients cannot download private originals and paid clients can.

Preview generation still downloads one original to temporary disk per worker. Allow at least 5 GB plus output/headroom for each concurrently running preview worker, and verify Render disk space and processing time with representative files. The web-media worker and custom-retainer worker can run concurrently. Automated tests use real small chunks and simulated 5 GB metadata; they do not establish live 5 GB transfer throughput or device memory behavior.

Reference: [Cloudflare R2 multipart uploads](https://developers.cloudflare.com/r2/objects/upload-objects/).

## Automated verification

- 38 focused tests pass: multipart size/ownership/recovery, browser chunk retries, existing media access and erasure rules, retainer workflow/payment regressions, and mobile retainer upload policy.
- Web/server production build, mobile TypeScript, and production iOS JS/Hermes export pass.
- The full web/server TypeScript check still reports existing errors. Compared with the parent commit using the same installed dependencies, this change introduces no new diagnostics.
- No production migration, deployment, native signing or real-device 5 GB transfer was performed by this source change.
