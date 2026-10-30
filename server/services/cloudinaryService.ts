import { v2 as cloudinary } from 'cloudinary';

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) return false;
  cloudinary.config({ cloud_name, api_key, api_secret });
  configured = true;
  return true;
}

export function isCloudinaryEnabled(): boolean {
  return ensureConfigured();
}

/** True for a base64 data URL (what the client sends before upload) — false for an already-hosted URL. */
export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

/**
 * Upload a base64 data URL to Cloudinary and return its hosted https URL.
 * Returns the original value unchanged if Cloudinary isn't configured or
 * the value isn't a data URL (already a hosted URL, or empty).
 */
export async function uploadDataUrlToCloudinary(
  dataUrl: string,
  folder: string
): Promise<string> {
  if (!isDataUrl(dataUrl)) return dataUrl;
  if (!ensureConfigured()) return dataUrl;
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
  });
  return result.secure_url;
}
