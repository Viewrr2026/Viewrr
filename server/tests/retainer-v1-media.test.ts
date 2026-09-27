import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRetainerPreview } from "../retainer-v1-media";
const exec = promisify(execFile);
test("actual image and video processing produces different watermarked preview files", async () => {
  const folder = await mkdtemp(join(tmpdir(), "viewrr-media-test-"));
  try {
    const image = join(folder, "original.png"),
      preview = join(folder, "preview.jpg");
    await exec("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=640x360",
      "-frames:v",
      "1",
      image,
    ]);
    const original = await readFile(image);
    await renderRetainerPreview(image, preview, "image/png");
    assert.ok((await stat(preview)).size > 500);
    assert.deepEqual(await readFile(image), original);
    const raw = await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        preview,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 5_000_000 },
    );
    // The blue input contains no white pixels; rendered text must introduce them.
    let white = 0;
    for (let i = 0; i < raw.stdout.length; i += 3)
      if (
        raw.stdout[i] > 180 &&
        raw.stdout[i + 1] > 180 &&
        raw.stdout[i + 2] > 180
      )
        white++;
    assert.ok(white > 100);
    const video = join(folder, "original.mp4"),
      videoPreview = join(folder, "preview.mp4");
    await exec("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=640x360:r=10",
      "-t",
      "1",
      "-c:v",
      "libx264",
      video,
    ]);
    const before = await readFile(video);
    await renderRetainerPreview(video, videoPreview, "video/mp4");
    assert.deepEqual(await readFile(video), before);
    assert.notDeepEqual(await readFile(videoPreview), before);
    await writeFile(join(folder, "bad"), "not a media file");
    await assert.rejects(() =>
      renderRetainerPreview(
        join(folder, "bad"),
        join(folder, "bad.jpg"),
        "image/png",
      ),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
