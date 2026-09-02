/**
 * Profile image encoding — data-URL parity with the web app (Decision 13).
 *
 * Viewrr stores `users.avatar` and `users.banner` as data URLs in TEXT columns.
 * R2 / object storage is explicitly later work, so mobile writes the same shape
 * the web app writes: a base64 image inside a `data:` URL, sent on
 * PATCH /api/users/:id.
 *
 * The Express body limit is 10 MB for the whole request, and web compresses to
 * under 300 KB (avatar) / 500 KB (banner). Those are the caps enforced here —
 * with a wide margin, because a data URL is ~4/3 the size of its bytes and the
 * same PATCH also carries the text fields.
 *
 * Two seams, deliberately empty today:
 *   • `registerImagePickerAdapter` — the native library picker. Adding
 *     `expo-image-picker` requires a change to mobile/package.json, which this
 *     agent does not own (M5 owns that file), so the picker is registered from
 *     outside instead of imported here. Until it is registered,
 *     `isImagePickingAvailable()` is false and the UI says so plainly rather
 *     than showing a button that does nothing.
 *   • `registerImageCompressor` — re-encode/downscale. React Native has no
 *     canvas, so without a native module the only honest option is to validate
 *     and cap rather than silently ship a 4 MB avatar. When a compressor is
 *     registered, images are downscaled and re-encoded as JPEG first.
 */

export type ImageKind = "avatar" | "banner";

export type ImageLimits = {
  /** Longest edge, in pixels, after compression. */
  maxDimension: number;
  /** JPEG quality, 0–1. */
  quality: number;
  /** Hard cap on the encoded bytes (before base64 expansion). */
  maxBytes: number;
  label: string;
};

export const IMAGE_LIMITS: Record<ImageKind, ImageLimits> = {
  avatar: { maxDimension: 512, quality: 0.72, maxBytes: 300 * 1024, label: "profile photo" },
  banner: { maxDimension: 1600, quality: 0.72, maxBytes: 500 * 1024, label: "banner" },
};

export type PickedImage = {
  uri: string;
  /** Present when the picker already produced base64 — saves a re-read. */
  base64?: string | null;
  mimeType?: string | null;
};

export type ImagePickerAdapter = (
  kind: ImageKind,
  limits: ImageLimits,
) => Promise<PickedImage | null>;

export type ImageCompressor = (input: {
  uri: string;
  maxDimension: number;
  quality: number;
}) => Promise<{ uri: string; mimeType?: string | null }>;

let pickerAdapter: ImagePickerAdapter | null = null;
let compressor: ImageCompressor | null = null;

export function registerImagePickerAdapter(adapter: ImagePickerAdapter | null): void {
  pickerAdapter = adapter;
}

export function registerImageCompressor(fn: ImageCompressor | null): void {
  compressor = fn;
}

export function isImagePickingAvailable(): boolean {
  return pickerAdapter !== null;
}

export function isImageCompressionAvailable(): boolean {
  return compressor !== null;
}

export type EncodedImage = {
  /** `data:image/…;base64,…` — exactly what the column stores. */
  dataUrl: string;
  /** Size of the decoded bytes, for honest "x KB" copy. */
  bytes: number;
  mimeType: string;
};

export class ImageEncodeError extends Error {}

const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** True for a string already in data-URL form. */
export function isDataUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

/** Bytes represented by a data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Read any local or remote image URI and return it as a size-capped data URL,
 * compressing first when a compressor is available.
 *
 * Throws `ImageEncodeError` with user-facing copy — the caller shows the
 * message as-is.
 */
export async function encodeImageAsDataUrl(
  uri: string,
  kind: ImageKind,
): Promise<EncodedImage> {
  const limits = IMAGE_LIMITS[kind];

  let sourceUri = uri;
  if (compressor) {
    try {
      const compressed = await compressor({
        uri,
        maxDimension: limits.maxDimension,
        quality: limits.quality,
      });
      sourceUri = compressed.uri;
    } catch {
      throw new ImageEncodeError("That image couldn't be prepared. Try a different one.");
    }
  }

  let blob: Blob;
  try {
    const response = await fetch(sourceUri);
    if (!response.ok) {
      throw new ImageEncodeError("That image couldn't be loaded. Check the link and try again.");
    }
    blob = await response.blob();
  } catch (cause) {
    if (cause instanceof ImageEncodeError) throw cause;
    throw new ImageEncodeError("That image couldn't be loaded. Check the link and try again.");
  }

  const mimeType = (blob.type || "").toLowerCase();
  if (mimeType && !ALLOWED_MIME.includes(mimeType)) {
    throw new ImageEncodeError("Use a JPEG, PNG or WebP image.");
  }

  if (blob.size > limits.maxBytes) {
    throw new ImageEncodeError(
      `That ${limits.label} is ${kb(blob.size)}. The limit is ${kb(limits.maxBytes)}` +
        (compressor
          ? "."
          : " — resize it, or pick a smaller image, and Viewrr will store it as-is."),
    );
  }

  const dataUrl = await readAsDataUrl(blob);
  return {
    dataUrl,
    bytes: blob.size,
    mimeType: mimeType || "image/jpeg",
  };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImageEncodeError("That image couldn't be read."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && result.startsWith("data:")) resolve(result);
      else reject(new ImageEncodeError("That image couldn't be read."));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Open the native library picker and return the encoded result, or null when
 * the user cancelled. Throws `ImageEncodeError` when no picker is registered,
 * so a caller that forgot to check `isImagePickingAvailable()` fails loudly
 * instead of appearing to work.
 */
export async function pickProfileImage(kind: ImageKind): Promise<EncodedImage | null> {
  if (!pickerAdapter) {
    throw new ImageEncodeError(
      "Choosing from your photo library isn't available in this build yet.",
    );
  }

  const limits = IMAGE_LIMITS[kind];
  const picked = await pickerAdapter(kind, limits);
  if (!picked) return null;

  if (picked.base64) {
    const mimeType = picked.mimeType ?? "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${picked.base64}`;
    const bytes = dataUrlBytes(dataUrl);
    if (bytes > limits.maxBytes) {
      throw new ImageEncodeError(
        `That ${limits.label} is ${kb(bytes)}. The limit is ${kb(limits.maxBytes)}.`,
      );
    }
    return { dataUrl, bytes, mimeType };
  }

  return encodeImageAsDataUrl(picked.uri, kind);
}
