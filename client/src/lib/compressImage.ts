const INITIAL_QUALITY = 0.82;
const MIN_QUALITY = 0.35;

/** Encode locally: fetching a data URL would be blocked by our connect-src policy. */
export function compressImage(file: File, maxWidthPx: number, maxSizeKB: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. Please choose a JPG, PNG or WebP image."));
    };
    img.onload = async () => {
      try {
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        if (!width || !height) throw new Error("This image has no readable dimensions.");
        if (width > maxWidthPx) {
          height = Math.max(1, Math.round(height * maxWidthPx / width));
          width = maxWidthPx;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not prepare this image. Please try again.");
        ctx.drawImage(img, 0, 0, width, height);
        const encode = (quality: number) => new Promise<Blob>((done, fail) => {
          canvas.toBlob(blob => blob ? done(blob) : fail(new Error("Could not compress this image. Please try another.")), "image/jpeg", quality);
        });
        let lo = MIN_QUALITY, hi = INITIAL_QUALITY, best: Blob | undefined;
        for (let i = 0; i < 8; i++) {
          const quality = (lo + hi) / 2;
          const attempt = await encode(quality);
          if (attempt.size <= maxSizeKB * 1024) { best = attempt; lo = quality; }
          else hi = quality;
        }
        resolve(best ?? await encode(MIN_QUALITY));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.src = url;
  });
}
