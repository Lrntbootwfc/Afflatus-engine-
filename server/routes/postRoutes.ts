import { Router } from 'express';
import { getAdminDb, resolveUserIdAsync } from '../services/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const postRoutes = Router();

// 1. POST /api/posts: Create a post
postRoutes.post('/posts', async (req, res) => {
  try {
    const db = getAdminDb();
    const { authorId, authorName, authorRole, authorAvatar, caption, imageUrl } = req.body;

    if (!authorId || (!caption && !imageUrl)) {
      return res.status(400).json({ error: 'Missing required fields.' });
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
    const snapshot = await db.collection('posts')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
      
    const posts = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return res.json({ posts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Server error' });
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
