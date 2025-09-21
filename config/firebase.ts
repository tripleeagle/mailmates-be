import admin, { ServiceAccount } from 'firebase-admin';
import { DecodedIdToken } from 'firebase-admin/auth';
import logger from './logger';

let firebaseApp: admin.app.App | null = null;



const initializeFirebase = (): admin.app.App | null => {
  try {
    // Check if Firebase is already initialized
    if (firebaseApp) {
      return firebaseApp;
    }

    // Check if required environment variables are present
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
      logger.warn('Firebase environment variables not configured. Authentication will not work.');
      return null;
    }

    // Initialize Firebase Admin SDK
    const serviceAccount: ServiceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey: process.env.FIREBASE_PRIVATE_KEY_ID ?? ''
    };

    logger.info('Initializing Firebase Admin SDK', { serviceAccount });
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
      ...(process.env.FIREBASE_STORAGE_BUCKET && { storageBucket: process.env.FIREBASE_STORAGE_BUCKET })
    });

    logger.info('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    logger.error('Firebase initialization error', { error: (error as Error).message });
    logger.warn('Continuing without Firebase. Authentication will not work.');
    return null;
  }
};

const getFirestore = (): admin.firestore.Firestore => {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized');
  }
  return admin.firestore();
};

const getAuth = (): admin.auth.Auth => {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized');
  }
  return admin.auth();
};

const verifyIdToken = async (idToken: string): Promise<DecodedIdToken> => {
  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    logger.error('Token verification error', { error: (error as Error).message });
    throw new Error('Invalid token');
  }
};

const getFirebaseApp = (): admin.app.App | null => {
  return firebaseApp;
};

export {
  initializeFirebase,
  getFirestore,
  getAuth,
  verifyIdToken,
  getFirebaseApp
};
