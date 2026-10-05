/** Injection token — swap in a fake in tests instead of hitting real Cloudinary. */
export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export interface UploadResult {
  url: string;
  publicId: string;
}

export interface StorageService {
  upload(buffer: Buffer, options: { folder: string; mimeType: string }): Promise<UploadResult>;
  delete(publicId: string): Promise<void>;
}
