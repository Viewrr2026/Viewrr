# Mobile upload parity audit — 14 October 2026

Implemented paths needing device testing: feed, portfolio photos/videos, showreel video, profile/banner and one-off deliveries. Photos and Files selectors use the same R2 backend, limits, processing and payment checks as web. Fixed uploaded photos being classified as feed videos, misleading photo play icons and outdated no-upload copy. Image-only posts are now supported.

Photos selection converts unsupported images such as HEIC to JPEG. Supported JPEG/PNG/WebP and videos are not converted by this uploader. Limits: 5 MB profile; 5 GB public media and project/cycle/custom-retainer deliveries. Videos remain limited to 30 minutes and 40-megapixel frames. Files selection rejects unidentified MIME types. The app reads 8 MB at a time with FileHandle and uploads each chunk with retries and progress; keep Viewrr open while uploading. Deploy migration 0018 and the matching server before releasing the new mobile build.

## Remaining differences

- Native retainer uploads now support custom and legacy cycles: Photos/Files, polling, retry, submission notes, preview and server-gated original downloads. Legacy work supports progress-stage updates and final submission. Billing, agreement changes and client review actions remain web workflows.
- Agency editing has no native screen.
- Native stage actions and delivery uploads use separate screens, unlike web Send Work.
- Legacy profile image-link/edit controls remain alongside R2 upload controls.
- ZIP, editable source projects, PDF and audio are unsupported by both new uploaders.
- Foreground upload only: keep the screen open. No background transfer/resume or camera capture.

## Build and test

New picker/manipulator dependencies require a new native binary. The EAS preview profile is internal distribution with a staging app identifier and API; it is not a TestFlight profile. Production-profile TestFlight builds target the production backend. Staging web deployment does not update the app binary or production API.

Device checks: Photos/Files cancellation, limited Photos access, HEIC, JPEG/PNG, portrait/landscape video, file size rejection, retry, feed reload, portfolio/showreel playback, profile/banner persistence, unpaid preview and paid original download, unrelated-account denial, expired sign-in.

TypeScript, release config and JS bundling do not replace a signed archive and iPhone testing. Native retainer uploads are implemented; agency editing and the other web workflows listed above remain separate. See `readiness/2026-10-14-r2-release.md` for the combined release and TestFlight handoff.
