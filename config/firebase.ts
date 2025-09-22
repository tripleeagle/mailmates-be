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
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? ''
    };

    logger.info('Firebase service account configured', { 
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail 
    });

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

/**
 * Validates Firebase configuration by checking required environment variables
 * @returns {boolean} True if configuration is valid, false otherwise
 */
const validateFirebaseConfig = (): boolean => {
  const requiredEnvVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL', 
    'FIREBASE_PRIVATE_KEY'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error('Firebase configuration validation failed', {
      missingEnvironmentVariables: missingVars,
      error: 'Required Firebase environment variables are missing'
    });
    return false;
  }

  // Validate private key format
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!privateKey?.includes('-----BEGIN PRIVATE KEY-----') || 
      !privateKey?.includes('-----END PRIVATE KEY-----')) {
    logger.error('Firebase configuration validation failed', {
      error: 'Invalid private key format - must be a valid PEM certificate'
    });
    return false;
  }

  logger.info('Firebase configuration validation passed', {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  });
  
  return true;
};

/**
 * Tests Firestore connectivity by performing a simple read operation
 * @returns {Promise<boolean>} True if Firestore is accessible, false otherwise
 */
const testFirestoreConnectivity = async (): Promise<boolean> => {
  try {
    if (!firebaseApp) {
      logger.error('Firestore connectivity test failed', {
        error: 'Firebase app not initialized'
      });
      return false;
    }

    const db = admin.firestore();
    
    // Test connectivity by attempting to read from a non-existent collection
    // This will succeed if Firestore is accessible, even if the document doesn't exist
    const testDoc = db.collection('_health_check').doc('connectivity_test');
    
    // Use get() with a timeout to test connectivity
    await Promise.race([
      testDoc.get(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Firestore connection timeout')), 5000)
      )
    ]);

    logger.info('Firestore connectivity test passed');
    return true;
    
  } catch (error) {
    logger.error('Firestore connectivity test failed', {
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    return false;
  }
};

/**
 * Comprehensive Firebase initialization with validation and connectivity testing
 * @returns {Promise<admin.app.App | null>} Firebase app instance or null if initialization fails
 */
const initializeFirebaseWithValidation = async (): Promise<admin.app.App | null> => {
  try {
    // Step 1: Validate configuration
    logger.info('Starting Firebase initialization with validation...');
    
    if (!validateFirebaseConfig()) {
      throw new Error('Firebase configuration validation failed');
    }

    // Step 2: Initialize Firebase Admin SDK
    const app = initializeFirebase();
    if (!app) {
      throw new Error('Firebase Admin SDK initialization failed');
    }

    // Step 3: Test Firestore connectivity
    const isFirestoreAccessible = await testFirestoreConnectivity();
    if (!isFirestoreAccessible) {
      throw new Error('Firestore connectivity test failed');
    }

    logger.info('Firebase initialization completed successfully with all validations passed');
    return app;
    
  } catch (error) {
    logger.error('Firebase initialization with validation failed', {
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    
    // Don't throw here - let the calling code decide how to handle the failure
    return null;
  }
};

export {
  initializeFirebase,
  initializeFirebaseWithValidation,
  validateFirebaseConfig,
  testFirestoreConnectivity,
  getFirestore,
  getAuth,
  verifyIdToken,
  getFirebaseApp
};
