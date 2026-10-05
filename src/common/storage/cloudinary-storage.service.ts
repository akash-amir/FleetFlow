import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import type { StorageService, UploadResult } from './storage.service.js';

// Reads credentials from CLOUDINARY_URL automatically — the Cloudinary SDK
// parses that env var itself as soon as the package is imported, so no
// explicit cloudinary.config() call is needed here. This does mean the value
// must at least be a syntactically valid URL (see .env.example) even before
// any upload is attempted — an invalid one throws at import time, crashing
// the whole app on boot, not just this feature.
@Injectable()
export class CloudinaryStorageService implements StorageService {
  upload(buffer: Buffer, options: { folder: string; mimeType: string }): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: options.folder, resource_type: 'image' },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary upload returned no result'));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  async delete(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
