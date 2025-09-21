import express, { Request, Response } from 'express';
import { verifyIdToken, getFirebaseApp } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse, User } from '../types';

const router = express.Router();

interface VerifyTokenRequest {
  token: string;
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
    
    logger.logAuth('token_verification', decodedToken.uid, true, {
      email: decodedToken.email,
      ip: req.ip
    });
    
    res.json({
      success: true,
      data: {
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email,
          name: decodedToken.name,
          picture: decodedToken.picture
        }
      }
    });
  } catch (error) {
    logger.logAuth('token_verification', 'unknown', false, {
      error: (error as Error).message,
      ip: req.ip
    });
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

export default router;
