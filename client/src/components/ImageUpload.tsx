import { uploadPublicImage } from "@/lib/uploadMedia";
import { compressImage } from "@/lib/compressImage";
/**
 * ImageUpload — drag-and-drop / camera roll image picker with in-browser compression.
 * Uploads the compressed JPEG and returns its server-hosted image URL.
 */

import { useRef, useState, useCallback } from "react";
import { UploadCloud, X, AlertCircle } from "lucide-react";

interface Props {
  value?: string;           // current data URL or remote URL (for preview)
  onChange: (url: string | undefined) => void;
  label: string;
  hint?: string;
  aspectRatio?: number;     // target w/h — e.g. 4 (banner) or 1 (avatar)
  maxSizeKB?: number;       // max output JPEG size in KB (default 400)
  maxWidthPx?: number;      // resize canvas to this width max (default 800)
  roundedFull?: boolean;    // show circle preview
}

export default function ImageUpload({
  value,
  onChange,
  label,
  hint,
  aspectRatio = 1,
  maxSizeKB   = 400,
  maxWidthPx  = 900,
  roundedFull = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]   = useState(false);
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState<string | null>(null);
  const [info,     setInfo]       = useState<string | null>(null);

  const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  const RAW_MAX_MB = 20; // reject files larger than this before even trying

  const processFile = useCallback(async (file: File) => {
    setError(null);
    setInfo(null);

    if (!ACCEPTED.includes(file.type) && !file.name.match(/\.(jpe?g|png|webp|heic|heif)$/i)) {
      setError("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > RAW_MAX_MB * 1024 * 1024) {
      setError(`File too large. Max ${RAW_MAX_MB}MB.`);
      return;
    }

    setLoading(true);
    try {
      const blob = await compressImage(file, maxWidthPx, maxSizeKB);
      onChange(await uploadPublicImage(new File([blob], "profile.jpg", {type:"image/jpeg"})));
      setInfo(`Compressed to ${Math.round(blob.size / 1024)}KB`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not upload this image. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [onChange, maxWidthPx, maxSizeKB]);

  function handleFiles(files: FileList | null) {
    if (files && files[0]) processFile(files[0]);
  }

  // Drag handlers
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true);  };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); };
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const hasImage = !!value;

  // -- Avatar (square / circle) preview --
  if (roundedFull) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="flex items-center gap-4">
          {/* Circle preview */}
          <div
            className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-border cursor-pointer flex-shrink-0 group"
            onClick={() => inputRef.current?.click()}
          >
            {hasImage ? (
              <>
                <img src={value} alt="Avatar" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <UploadCloud size={18} className="text-white" />
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <UploadCloud size={20} className="text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Text side */}
          <div className="flex-1 space-y-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="text-sm font-medium text-primary hover:underline"
            >
              {loading ? "Processing…" : hasImage ? "Change photo" : "Upload photo"}
            </button>
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
            {info  && <p className="text-[11px] text-green-600 dark:text-green-400">{info}</p>}
            {error && (
              <p className="flex items-center gap-1 text-[11px] text-destructive">
                <AlertCircle size={10} /> {error}
              </p>
            )}
            {hasImage && (
              <button
                type="button"
                onClick={() => { onChange(undefined); setInfo(null); }}
                className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-0.5"
              >
                <X size={10} /> Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          capture="environment"
          className="hidden"
          disabled={loading}
          onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>
    );
  }

  // -- Banner (wide) preview --
  const paddingPercent = `${(1 / aspectRatio) * 100}%`;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>

      {/* Drop zone */}
      <div
        className={`relative w-full rounded-xl border-2 overflow-hidden cursor-pointer transition-colors
          ${dragging
            ? "border-primary bg-primary/5"
            : hasImage
              ? "border-border hover:border-primary/50"
              : "border-dashed border-border hover:border-primary/50 hover:bg-muted/50"
          }`}
        style={{ paddingBottom: hasImage ? 0 : paddingPercent }}
        onClick={() => !hasImage && inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {hasImage ? (
          <div className="relative">
            <img
              src={value}
              alt={label}
              className="w-full object-cover"
              style={{ maxHeight: "140px" }}
            />
            {/* Actions overlay */}
            <div className="absolute top-2 right-2 flex gap-1.5">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
                className="bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition-colors"
                title="Change image"
              >
                <UploadCloud size={13} />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onChange(undefined); setInfo(null); }}
                className="bg-black/60 hover:bg-destructive text-white rounded-full p-1.5 transition-colors"
                title="Remove"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground p-4">
            {loading ? (
              <p className="text-sm">Processing…</p>
            ) : (
              <>
                <UploadCloud size={24} className={dragging ? "text-primary" : "opacity-50"} />
                <p className="text-sm font-medium">
                  {dragging ? "Drop to upload" : "Tap to choose or drag & drop"}
                </p>
                <p className="text-xs opacity-60">JPG, PNG or WebP · max {RAW_MAX_MB}MB raw</p>
              </>
            )}
          </div>
        )}
      </div>

      {hint  && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {info  && <p className="text-[11px] text-green-600 dark:text-green-400">{info}</p>}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle size={10} /> {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        className="hidden"
        disabled={loading}
        onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
