/**
 * Firebase Admin (Batch D) — optional.
 * If GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON is set,
 * verifies ID tokens. Otherwise falls back to x-user-id (dev mode).
 */
import type { Request } from 'express';
import { getApps, getApp, initializeApp, type App } from 'firebase-admin/app';
import { cert, applicationDefault } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;
let initAttempted = false;

export function isFirebaseAdminReady(): boolean {
  ensureInit();
  return Boolean(adminAuth);
}

function ensureInit() {
  if (initAttempted) return;
  initAttempted = true;
  try {
    if (getApps().length) {
      adminApp = getApp();
    } else {
      const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (json) {
        const parsedCred = JSON.parse(json);
        adminApp = initializeApp({ credential: cert(parsedCred) });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        adminApp = initializeApp({
          credential: applicationDefault(),
        });
      } else {
        console.warn(
          '[FirebaseAdmin] Not configured — using x-user-id dev auth. Set FIREBASE_SERVICE_ACCOUNT_JSON to enable token verify.'
        );
        return;
      }
    }
    adminAuth = getAuth(adminApp);
    adminDb = getFirestore(adminApp);
    console.log('[FirebaseAdmin] Ready');
  } catch (err: any) {
    console.warn('[FirebaseAdmin] Init skipped:', err?.message || err);
  }
}

export function getAdminDb() {
  ensureInit();
  if (!adminDb) {
    throw new Error('Firebase Admin DB is not initialized.');
  }
  return adminDb;
}

/** Verify Bearer token → uid, or null */
export async function verifyIdToken(req: Request): Promise<string | null> {
  ensureInit();
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || !adminAuth) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid as string;
  } catch (err: any) {
    console.warn('[FirebaseAdmin] Token verify failed:', err?.message || err);
    return null;
  }
}

/**
 * Resolve user id: Firebase token first, then x-user-id (dev only).
 *
 * The x-user-id / userId fallback is unauthenticated — anyone who knows a uid
 * can impersonate that user through it. It must never be trusted in production.
 */
export async function resolveUserIdAsync(req: Request): Promise<string | null> {
  const fromToken = await verifyIdToken(req);
  if (fromToken) return fromToken;
  if (process.env.NODE_ENV === 'production') return null;
  const h = req.headers['x-user-id'] || req.headers['x-userid'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (typeof req.query.userId === 'string') return req.query.userId;
  if (typeof (req.body as any)?.userId === 'string') return (req.body as any).userId;
  return null;
}
