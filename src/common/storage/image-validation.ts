import { BadRequestException } from '@nestjs/common';

export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Multer fileFilter: fast, cheap first pass on the client-declared mimetype. Not authoritative — see sniffImageMimeType. */
export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    callback(new BadRequestException(`Unsupported file type for ${file.fieldname}: ${file.mimetype}`), false);
    return;
  }
  callback(null, true);
}

/**
 * Identifies an image by its magic bytes, ignoring whatever mimetype the
 * client claimed. A client can set `Content-Type: image/jpeg` on any file
 * it likes — this is the check that actually matters. Returns null if the
 * buffer doesn't start with a signature we recognize.
 */
export function sniffImageMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
