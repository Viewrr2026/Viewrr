# R2 media uploads across Viewrr

Based on `fix/retainer-protected-delivery` (PR #11). This extension adds file selection to web one-off deliveries, Send Work, feed, portfolio, signup portfolio, agency media, profile images, and legacy retainer progress/final submissions. Mobile adds feed, portfolio, profile/banner and one-off uploads. Existing custom-retainer uploads remain in PR #11.

## Access and processing

Public feed/portfolio/profile uploads are shareable as soon as processing succeeds. Project and cycle originals require the freelancer identity or verified payment plus project membership. Clients can review burned-in watermarked previews before payment. Stable application URLs redirect to 60-second signed R2 URLs; native clients resolve those URLs using bearer authentication. No R2 credentials enter clients.

Uploads accept JPEG, PNG, WebP, MP4, MOV and WebM. Limits: profile images 5 MB, public media 50 MB, project/cycle media 200 MB. PDF, ZIP, audio and editable source-project formats are not implemented by this media uploader. External links remain supported and retain their provider's access controls.

The worker runs inside the web process, serially, with durable queued/processing/failed states in existing upload_objects. Processing requires FFmpeg drawtext/libx264 and ffprobe. Failed jobs can be retried; interrupted processing can be reclaimed after 20 minutes. Keep the upload form open until ready. Free-instance sleep can delay processing. Large-video throughput and memory need staging observation.

## Staging rollout

1. Review this branch together with PR #11; keep production unchanged.
2. Set staging source branch to `feat/r2-media-across-workspaces` and deploy it.
3. Retain OBJECT_STORAGE_ACCESS_KEY_ID, OBJECT_STORAGE_SECRET_ACCESS_KEY, OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_REGION and RETAINER_PRIVATE_STORAGE_CONFIRMED=true. The bucket must remain private. No new database migration is required by this extension; PR #11 migrations are prerequisites.
4. Upload an image and small video from a freelancer's one-off project. Wait for processing, then submit the work.
5. As its unpaid client, review the watermark and confirm original download is denied. A different account must get no private media access. After verified payment, confirm the original downloads; test a refunded payment remains blocked.
6. Publish a feed image/video and portfolio item; reload and view from another account. Check profile, agency and legacy retainer uploads too.
7. Build a new native app with expo-document-picker; this native dependency requires a new binary. Test iOS/Android selection, upload, preview and download. A server deploy alone does not update TestFlight.

Local checks do not establish a live R2 connection. Staging end-to-end checks, a native binary build, and browser/device visual review remain release gates.
