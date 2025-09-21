import express, { Request, Response } from 'express';
import { verifyIdToken, getFirebaseApp } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse, User } from '../types';
import userService from '../services/userService';

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
    logger.logAuth('token_verification', 'unknown', false, {
      error: (error as Error).message,
      ip: req.ip
    });
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

export default router;
