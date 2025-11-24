import express, { Request, Response } from 'express';
import { verifyIdToken, getFirebaseApp, getAuth } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse, User } from '../types';
import userService from '../services/userService';

const router = express.Router();

interface VerifyTokenRequest {
  token: string;
}

interface RefreshTokenRequest {
  token: string; // Current token (can be expired)
}

interface FirebaseSignInResponse {
  idToken: string;
  refreshToken?: string;
  expiresIn?: string;
  localId?: string;
}

// Verify token endpoint
router.post('/verify-token', async (req: Request<{}, ApiResponse<{ user: User }>, VerifyTokenRequest>, res: Response<ApiResponse<{ user: User }>>) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      logger.logSecurity('Token verification failed', { reason: 'Missing token', ip: req.ip });
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    // Check if Firebase is initialized
    const firebaseApp = getFirebaseApp();
    if (!firebaseApp) {
      logger.error('Firebase not initialized', { ip: req.ip });
      return res.status(503).json({ success: false, error: 'Authentication service not available' });
    }

    const decodedToken = await verifyIdToken(token);
    
    // Store/update user data in backend after successful verification
    const storedUser = await userService.storeUser(decodedToken);
    
    logger.logAuth('token_verification', decodedToken.email || decodedToken.uid, true, {
      email: decodedToken.email,
      uid: decodedToken.uid,
      ip: req.ip,
      userStored: true
    });
    
    res.json({
      success: true,
      data: {
        user: {
          uid: storedUser.uid,
          email: storedUser.email,
          name: storedUser.name,
          picture: storedUser.picture
        }
      }
    });
  } catch (error) {
    const errorMessage = (error as Error).message;
    const errorCode = (error as any).code || '';
    
    // Check multiple ways to detect token expiration
    const isTokenExpired = 
      errorMessage.includes('auth/id-token-expired') || 
      errorMessage.includes('token has expired') ||
      errorCode === 'auth/id-token-expired';
    
    logger.error('Token verification error', { 
      error: errorMessage,
      code: errorCode
    });
    
    logger.logAuth('token_verification', 'unknown', false, {
      error: isTokenExpired ? 'Token expired' : 'Invalid token',
      expired: isTokenExpired,
      ip: req.ip
    });
    
    // Return appropriate error message based on token expiration
    const errorMsg = isTokenExpired ? 'Token expired' : 'Invalid token';
    res.status(401).json({ 
      success: false, 
      error: errorMsg
    });
  }
});

// Refresh token endpoint - accepts current token and returns a new ID token
router.post('/refresh-token', async (req: Request<{}, ApiResponse<{ token: string; user: User }>, RefreshTokenRequest>, res: Response<ApiResponse<{ token: string; user: User }>>) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      logger.logSecurity('Token refresh failed', { reason: 'Missing token', ip: req.ip });
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    // Check if Firebase is initialized
    const firebaseApp = getFirebaseApp();
    if (!firebaseApp) {
      logger.error('Firebase not initialized', { ip: req.ip });
      return res.status(503).json({ success: false, error: 'Authentication service not available' });
    }

    let uid: string;
    let decodedToken: any;

    // Try to verify the token first (works if token is still valid)
    try {
      decodedToken = await verifyIdToken(token);
      uid = decodedToken.uid;
    } catch (error) {
      // If token is expired, decode it without verification to extract UID
      // JWT can be decoded without verification to read the payload
      try {
        const parts = token.split('.');
        if (parts.length !== 3) {
          throw new Error('Invalid token format');
        }
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        uid = payload.uid || payload.user_id;
        
        if (!uid) {
          throw new Error('UID not found in token');
        }
        
        logger.info('Token expired, extracted UID from payload', { uid });
      } catch (decodeError) {
        logger.error('Failed to decode token', { error: (decodeError as Error).message });
        logger.logAuth('token_refresh', 'unknown', false, {
          error: 'Invalid or expired token',
          ip: req.ip
        });
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
      }
    }

    // Verify user exists in Firebase Auth
    const auth = getAuth();
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (error) {
      logger.error('User not found in Firebase Auth', { uid, error: (error as Error).message });
      logger.logAuth('token_refresh', uid, false, {
        error: 'User not found',
        ip: req.ip
      });
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Create a custom token for this user
    const customToken = await auth.createCustomToken(uid);

    // Exchange custom token for ID token using Firebase REST API
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) {
      logger.error('FIREBASE_API_KEY not configured');
      return res.status(500).json({ success: false, error: 'Server configuration error' });
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const identityToolkitUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;

    const exchangeResponse = await fetch(identityToolkitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true,
      }),
    });

    if (!exchangeResponse.ok) {
      const errorData = await exchangeResponse.json();
      logger.error('Failed to exchange custom token for ID token', { error: errorData });
      throw new Error('Failed to exchange custom token');
    }

    const exchangeData = await exchangeResponse.json() as FirebaseSignInResponse;
    const idToken = exchangeData.idToken;

    if (!idToken) {
      logger.error('No ID token in exchange response');
      throw new Error('Failed to get ID token');
    }

    // Verify the new token to get user info
    const newDecodedToken = await verifyIdToken(idToken);
    
    // Store/update user data in backend
    const storedUser = await userService.storeUser(newDecodedToken);

    logger.logAuth('token_refresh', uid, true, {
      email: userRecord.email,
      uid: uid,
      ip: req.ip
    });

    res.json({
      success: true,
      data: {
        token: idToken,
        user: {
          uid: storedUser.uid,
          email: storedUser.email,
          name: storedUser.name,
          picture: storedUser.picture
        }
      }
    });
  } catch (error) {
    logger.error('Token refresh error', { error: (error as Error).message, stack: (error as Error).stack });
    logger.logAuth('token_refresh', 'unknown', false, {
      error: (error as Error).message,
      ip: req.ip
    });
    res.status(500).json({ success: false, error: 'Token refresh failed' });
  }
});

export default router;
