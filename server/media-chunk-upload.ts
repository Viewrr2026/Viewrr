import multer from 'multer';
import { tmpdir } from 'node:os';
import { MEDIA_PART_BYTES } from '../shared/media-upload';

// Multer 2.5 treats fileSize as inclusive and adjusts Busboy's boundary itself.
// Use the negotiated size so the first excess byte still triggers rejection.
// The multipart service separately verifies the exact expected part length.
export const chunkUpload = multer({ dest: tmpdir(), limits: { fileSize: MEDIA_PART_BYTES, files: 1, fields: 0 } });
