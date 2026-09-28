import { Router } from 'express';
import { getAdminDb, resolveUserIdAsync } from '../services/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const postRoutes = Router();

// 1. POST /api/posts: Create a post
/** Approx decoded byte length of a data URL (base64). */
function dataUrlByteLength(dataUrl: string): number {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  if (!dataUrl.startsWith('data:')) return 0;
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}

const POST_IMAGE_HARD_MAX = 1 * 1024 * 1024; // 1 MB — matches client mediaLimits

postRoutes.post('/posts', async (req, res) => {
  try {
    const db = getAdminDb();
    const { authorId, authorName, authorRole, authorAvatar, caption, imageUrl } = req.body;

    if (!authorId || (!caption && !imageUrl)) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Server-side media limit (do not rely on frontend alone)
    if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
      const bytes = dataUrlByteLength(imageUrl);
      if (bytes > POST_IMAGE_HARD_MAX) {
        return res.status(400).json({
          error: `Image exceeds maximum size of 1 MB (received ~${Math.round(bytes / 1024)} KB). Compress before upload.`,
        });
      }
    }

    const postDoc = {
      authorId,
      authorName,
      authorRole: authorRole || 'Creator',
      authorAvatar: authorAvatar || null,
      caption: caption || '',
      imageUrl: imageUrl || null,
      likes: [],
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection('posts').add(postDoc);
    try {
      await db.collection('users').doc(authorId).set(
        { postsCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('[posts] postsCount increment failed', e);
    }
    return res.status(201).json({ success: true, post: { id: docRef.id, ...postDoc } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// 2. GET /api/posts: Get global feed (all posts)
postRoutes.get('/posts', async (req, res) => {
  try {
    const db = getAdminDb();
    let posts: any[] = [];
    try {
      const snapshot = await db.collection('posts')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      posts = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    } catch (queryErr: any) {
      // Missing index / field type mismatch — fallback scan + client sort
      console.warn('[posts] orderBy feed failed, fallback:', queryErr?.message || queryErr);
      const snapshot = await db.collection('posts').limit(80).get();
      posts = snapshot.docs
        .map((doc: any) => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 50);
    }
    return res.json({ posts });
  } catch (error: any) {
    console.error('[posts] GET /posts:', error?.message || error);
    return res.status(500).json({
      error: error.message || 'Server error',
      posts: [],
    });
  }
});

// 3. GET /api/posts/user/:userId: Get posts for a specific user
postRoutes.get('/posts/user/:userId', async (req, res) => {
  try {
    const db = getAdminDb();
    const { userId } = req.params;
    let posts: any[] = [];
    try {
      const snapshot = await db.collection('posts')
        .where('authorId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();
      posts = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    } catch (indexErr: any) {
      // Missing composite index — fallback
      const snapshot = await db.collection('posts').where('authorId', '==', userId).get();
      posts = snapshot.docs
        .map((doc: any) => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }
    return res.json({ posts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// 3b. GET /api/posts/:postId — single post (deep links / share)
postRoutes.get('/posts/:postId', async (req, res) => {
  try {
    const db = getAdminDb();
    const { postId } = req.params;
    const snap = await db.collection('posts').doc(postId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Post not found' });
    }
    return res.json({ post: { id: snap.id, ...snap.data() } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});


// 3c. PUT /api/posts/:postId — owner edit caption (and optional imageUrl)
postRoutes.put('/posts/:postId', async (req, res) => {
  try {
    const db = getAdminDb();
    const { postId } = req.params;
    const { userId, caption, imageUrl } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'User ID is required' });
    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Post not found' });
    const data = snap.data() || {};
    if (data.authorId !== userId) return res.status(403).json({ error: 'Only the author can edit this post' });
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (typeof caption === 'string') update.caption = caption.slice(0, 5000);
    if (typeof imageUrl === 'string') update.imageUrl = imageUrl;
    await ref.update(update);
    const next = await ref.get();
    return res.json({ success: true, post: { id: next.id, ...next.data() } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// 4. POST /api/posts/:postId/like: Toggle like
postRoutes.post('/posts/:postId/like', async (req, res) => {
  try {
    const db = getAdminDb();
    const { postId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'User ID is required' });
    }

    // Incomplete profiles may browse but cannot Like
    try {
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists || userSnap.data()?.profileCompleted !== true) {
        return res.status(403).json({
          error: 'Complete your profile before liking posts.',
          code: 'PROFILE_INCOMPLETE',
        });
      }
    } catch (e) {
      console.warn('[posts/like] profile check failed', e);
    }

    const postRef = db.collection('posts').doc(postId);
    
    await db.runTransaction(async (t: any) => {
      const doc = await t.get(postRef);
      if (!doc.exists) {
        throw new Error('Post not found');
      }
      const data = doc.data();
      const likes = data.likes || [];
      if (likes.includes(userId)) {
        t.update(postRef, { likes: FieldValue.arrayRemove(userId) });
      } else {
        t.update(postRef, { likes: FieldValue.arrayUnion(userId) });
      }
    });

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// 5. DELETE /api/posts/:postId: Delete a post
postRoutes.delete('/posts/:postId', async (req, res) => {
  try {
    const db = getAdminDb();
    const { postId } = req.params;
    const userId =
      (typeof req.headers['x-user-id'] === 'string' && req.headers['x-user-id']) ||
      (typeof req.body?.userId === 'string' && req.body.userId) ||
      '';

    const ref = db.collection('posts').doc(postId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Post not found' });
    const data = snap.data() || {};
    if (userId && data.authorId && data.authorId !== userId) {
      return res.status(403).json({ error: 'Only the author can delete this post' });
    }
    await ref.delete();
    if (data.authorId) {
      try {
        await db.collection('users').doc(data.authorId).set(
          { postsCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      } catch (e) {
        console.warn('[posts] postsCount decrement failed', e);
      }
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// 6. POST /api/collaborations/activate-count
// Client cannot write another user's profile (Firestore rules: owner-only).
// When both parties reach "collaborating", Admin increments collaborationCount on both.
postRoutes.post('/collaborations/activate-count', async (req, res) => {
  try {
    const db = getAdminDb();
    const actingUserId = await resolveUserIdAsync(req);
    if (!actingUserId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const { connectionId } = req.body || {};
    if (!connectionId || typeof connectionId !== 'string') {
      return res.status(400).json({ error: 'connectionId required.' });
    }

    const connRef = db.collection('connections').doc(connectionId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return res.status(404).json({ error: 'Connection not found.' });
    }
    const data = connSnap.data() as any;
    if (data.senderId !== actingUserId && data.recipientId !== actingUserId) {
      return res.status(403).json({ error: 'Not a party to this connection.' });
    }
    if (data.status !== 'collaborating' && data.status !== 'completed') {
      return res.status(400).json({
        error: 'Connection is not in collaborating status yet.',
        status: data.status,
      });
    }
    if (data.collaborationCountApplied === true) {
      return res.json({ success: true, alreadyApplied: true });
    }

    const batch = db.batch();
    for (const uid of [data.senderId, data.recipientId]) {
      if (!uid) continue;
      batch.set(
        db.collection('users').doc(uid),
        {
          collaborationCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    batch.update(connRef, {
      collaborationCountApplied: true,
      updatedAt: new Date().toISOString(),
    });
    await batch.commit();

    return res.json({
      success: true,
      senderId: data.senderId,
      recipientId: data.recipientId,
    });
  } catch (error: any) {
    console.error('[collaborations/activate-count]', error?.message || error);
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

/** Count real collaborations for a user from connection documents (source of truth). */
async function countCollaborationsFromConnections(db: any, userId: string): Promise<number> {
  const statuses = new Set(['collaborating', 'completed']);
  const seen = new Set<string>();
  let count = 0;

  const [asSender, asRecipient] = await Promise.all([
    db.collection('connections').where('senderId', '==', userId).get(),
    db.collection('connections').where('recipientId', '==', userId).get(),
  ]);

  for (const snap of [asSender, asRecipient]) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const st = String((doc.data() as any)?.status || '');
      if (statuses.has(st)) count += 1;
    }
  }
  return count;
}

// 7. GET /api/users/:userId/collaboration-count
// Derived from existing connections — not from a counter that starts at 0.
// Public number only (no peer identities). Also backfills users.collaborationCount.
postRoutes.get('/users/:userId/collaboration-count', async (req, res) => {
  try {
    const db = getAdminDb();
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const count = await countCollaborationsFromConnections(db, userId);

    // Keep denormalized field in sync for profile docs / older UI readers
    try {
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      const prev = userSnap.exists ? Number((userSnap.data() as any)?.collaborationCount) || 0 : 0;
      if (prev !== count) {
        await userRef.set(
          { collaborationCount: count, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
    } catch (e: any) {
      console.warn('[collaboration-count] backfill write skipped:', e?.message || e);
    }

    return res.json({ userId, count });
  } catch (error: any) {
    console.error('[collaboration-count]', error?.message || error);
    return res.status(500).json({ error: error.message || 'Server error', count: 0 });
  }
});

