import multer from 'multer';
import { tmpdir } from 'node:os';
import { MEDIA_PART_BYTES } from '../shared/media-upload';

// Busboy reports LIMIT_FILE_SIZE when the part reaches the configured limit.
// Permit the negotiated size; the first excess byte still triggers rejection.
// The multipart service separately verifies the exact expected part length.
export const chunkUpload = multer({ dest: tmpdir(), limits: { fileSize: MEDIA_PART_BYTES + 1, files: 1, fields: 0 } });
