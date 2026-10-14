# Protected retainer delivery rollout

This change restores direct image/video uploads and in-workspace burned-in previews. The original is accessible only for an approved submission in the corresponding verified-paid cycle. Unpaid, failed-preview, unrelated-account and wrong-cycle requests fail closed. Existing external links remain labelled legacy and cannot retroactively become protected. Re-upload source media to use protected delivery; do not import arbitrary remote URLs on the server.

## Storage configuration (required before enabling)

Create a separate private R2 bucket for each environment. Disable both public r2.dev access and custom public domains; do not expose it through a public Worker. Restrict the R2 token to this bucket. No browser credentials are used. Server multipart upload goes to R2 with server-generated immutable keys. Do not configure lifecycle deletion until a retention policy is agreed; paid files must remain accessible.

Set these server-only variables on the matching Render service:

- OBJECT_STORAGE_ENDPOINT: the S3 API endpoint shown by Cloudflare for the bucket/jurisdiction
- OBJECT_STORAGE_BUCKET: private bucket name
- OBJECT_STORAGE_ACCESS_KEY_ID: bucket-scoped token access ID
- OBJECT_STORAGE_SECRET_ACCESS_KEY: token secret (never commit or paste into chat)
- OBJECT_STORAGE_REGION: auto
- RETAINER_PRIVATE_STORAGE_CONFIRMED: true, only after checking the bucket is private
- CUSTOM_RETAINERS_ENABLED: true (starts the existing media/notification worker)

The current storage adapter is shared with other uploads. If OBJECT_STORAGE_* is already configured, verify the existing bucket is private before enabling; do not silently replace a bucket containing existing files.

The runtime needs ffmpeg with drawtext/libx264, ffprobe and a font. Dockerfile.retainer-media supplies these for a Render Docker service. Merely adding environment variables to a native Node service does not install FFmpeg. Use staging first. The Dockerfile has not been built in the local agent environment.

## Limits and behaviour

JPEG, PNG, WebP, MP4, MOV, WebM; maximum 200 MB, 30-minute videos, 40 million pixels. Google Docs/Sheets, PDF, ZIP and audio-only delivery are not supported by this preview renderer. Upload remains separate from submission: wait for preview, inspect it, then submit for client review. Preview failures keep originals private and offer retry. Signed preview URLs last one hour to support video seeking; clean-download URLs last 60 seconds and use attachment disposition. An already downloaded file cannot be revoked.

## Payment processing

After Stripe confirmation the UI says Confirming your payment… and disables another payment. A read-only status endpoint reconciles retries/refreshes. It never marks the cycle paid: the verified webhook remains authoritative. The workspace polling clears processing on paid. Genuine declines remain errors and allow retry.

## Staging release gate

- Confirm FFmpeg drawtext, ffprobe and a font in deployed runtime.
- Upload an image and a short video. Confirm inline preview contains a burned-in watermark and retains playback controls.
- Client cannot fetch original before payment or unsubmitted preview. Test a second account and a different cycle.
- Approve, pay once, observe confirming state then verified success without red 409 or duplicate charge.
- Download approved original after payment; verify original bytes unchanged.
- Fail a preview; confirm no clean URL leaks and retry works.
- Confirm notifications, history and paid-file access after cycle/retainer completion.

No production deployment or new iOS build is included in this change.

References: https://developers.cloudflare.com/r2/get-started/s3/ and https://developers.cloudflare.com/r2/api/s3/presigned-urls/
