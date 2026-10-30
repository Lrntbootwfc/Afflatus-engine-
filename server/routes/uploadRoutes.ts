import { Router } from 'express';
import { resolveUserIdAsync } from '../services/firebaseAdmin';
import { uploadDataUrlToCloudinary, isDataUrl } from '../services/cloudinaryService';

export const uploadRoutes = Router();

const IMAGE_HARD_MAX = 8 * 1024 * 1024; // 8 MB

function dataUrlByteLength(dataUrl: string): number {
  if (!isDataUrl(dataUrl)) return 0;
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}

/**
 * POST /api/uploads/image
 * Accepts a base64 data URL, uploads it to Cloudinary, returns the hosted URL.
 * Used for profile avatar / cover banner uploads (written directly to Firestore
 * by the client afterward) so no base64 image data ends up stored in Firestore.
 */
uploadRoutes.post('/uploads/image', async (req, res) => {
  try {
    const userId = await resolveUserIdAsync(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { dataUrl, folder } = req.body || {};
    if (!isDataUrl(dataUrl)) {
      return res.status(400).json({ error: 'dataUrl must be a base64 data: URL' });
    }
    const bytes = dataUrlByteLength(dataUrl);
    if (bytes > IMAGE_HARD_MAX) {
      return res.status(400).json({
        error: `Image exceeds maximum size of 8 MB (received ~${Math.round(bytes / 1024)} KB).`,
      });
    }

    const safeFolder = typeof folder === 'string' && /^[a-zA-Z0-9/_-]+$/.test(folder)
      ? folder
      : 'afflatus/profiles';
    const url = await uploadDataUrlToCloudinary(dataUrl, safeFolder);
    res.json({ url });
  } catch (err: any) {
    console.error('[uploads/image]', err?.message || err);
    res.status(502).json({ error: 'Upload failed' });
  }
});
