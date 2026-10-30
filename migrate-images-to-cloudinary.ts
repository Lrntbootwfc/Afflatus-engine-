/**
 * One-off migration: find every base64 data: URL image/avatar already stored
 * in Firestore (posts.imageUrl, posts.authorAvatar, users.avatarUrl,
 * users.coverImageUrl) and replace it with a Cloudinary-hosted URL.
 *
 * Run with: npx tsx migrate-images-to-cloudinary.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { getAdminDb } from './server/services/firebaseAdmin';
import { uploadDataUrlToCloudinary, isDataUrl } from './server/services/cloudinaryService';

async function migratePosts() {
  const db = getAdminDb();
  const snapshot = await db.collection('posts').get();
  let updated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const patch: Record<string, string> = {};
    if (isDataUrl(data.imageUrl)) {
      patch.imageUrl = await uploadDataUrlToCloudinary(data.imageUrl, 'afflatus/posts');
    }
    if (isDataUrl(data.authorAvatar)) {
      patch.authorAvatar = await uploadDataUrlToCloudinary(data.authorAvatar, 'afflatus/avatars');
    }
    if (Object.keys(patch).length) {
      await doc.ref.update(patch);
      updated++;
      console.log(`[posts] migrated ${doc.id}`);
    }
  }
  console.log(`[posts] done — ${updated}/${snapshot.size} updated`);
}

async function migrateUsers() {
  const db = getAdminDb();
  const snapshot = await db.collection('users').get();
  let updated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const patch: Record<string, string> = {};
    if (isDataUrl(data.avatarUrl)) {
      patch.avatarUrl = await uploadDataUrlToCloudinary(data.avatarUrl, 'afflatus/avatars');
    }
    if (isDataUrl(data.coverImageUrl)) {
      patch.coverImageUrl = await uploadDataUrlToCloudinary(data.coverImageUrl, 'afflatus/covers');
    }
    if (Object.keys(patch).length) {
      await doc.ref.update(patch);
      updated++;
      console.log(`[users] migrated ${doc.id}`);
    }
  }
  console.log(`[users] done — ${updated}/${snapshot.size} updated`);
}

async function main() {
  await migratePosts();
  await migrateUsers();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
