import { test } from "node:test";
import assert from "node:assert/strict";
import { compressImage } from "../../client/src/lib/compressImage";

function browser(t: any, failure?: "decode" | "canvas" | "encode" | "draw") {
  const released: string[] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => failure === "canvas" ? null : {
      drawImage() { if (failure === "draw") throw new Error("Drawing failed"); },
    },
    toBlob(callback: (blob: Blob | null) => void, type: string, quality: number) {
      queueMicrotask(() => callback(failure === "encode" ? null : new Blob([new Uint8Array(Math.ceil(quality * 500_000))], { type })));
    },
  };
  class ImageStub {
    naturalWidth = 2000;
    naturalHeight = 1000;
    onload: () => void = () => {};
    onerror: () => void = () => {};
    set src(_: string) { queueMicrotask(() => failure === "decode" ? this.onerror() : this.onload()); }
  }
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "Image", { configurable: true, value: ImageStub });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
  t.mock.method(URL, "createObjectURL", () => "blob:local-image");
  t.mock.method(URL, "revokeObjectURL", (url: string) => released.push(url));
  t.mock.method(globalThis, "fetch", async () => assert.fail("local encoding must not fetch a data URL"));
  t.after(() => {
    for (const [key, descriptor] of [["Image", originalImage], ["document", originalDocument]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { canvas, released };
}

test("profile images become uploadable JPEG blobs without a connect-src request", async t => {
  const { canvas, released } = browser(t);
  const blob = await compressImage(new File(["input"], "logo.png", { type: "image/png" }), 500, 300);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "image/jpeg");
  assert.ok(blob.size <= 300 * 1024);
  assert.deepEqual([canvas.width, canvas.height], [500, 250]);
  assert.deepEqual(released, ["blob:local-image"]);
  const upload = new File([blob], "profile.jpg", { type: blob.type });
  assert.equal(upload.size, blob.size);
});

for (const failure of ["decode", "canvas", "encode", "draw"] as const) {
  test(`image ${failure} failure rejects and releases the local object URL`, async t => {
    const { released } = browser(t, failure);
    await assert.rejects(compressImage(new File(["input"], "logo.png"), 500, 300));
    assert.deepEqual(released, ["blob:local-image"]);
  });
}
