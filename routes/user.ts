import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { verifyIdToken, getFirestore } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse, User, AISettings } from '../types';

const router = express.Router();

interface UserSettings extends AISettings {
  createdAt: Date;
  updatedAt: Date;
}

interface UpdateSettingsRequest {
  settings: Partial<AISettings>;
}

// Middleware to verify authentication
const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.logSecurity('Authentication failed', { reason: 'No token provided', ip: req.ip });
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    logger.logAuth('api_authentication', 'unknown', false, {
      error: (error as Error).message,
      ip: req.ip,
      endpoint: req.originalUrl
    });
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Validation schema for settings update
const updateSettingsSchema = Joi.object({
  settings: Joi.object({
    language: Joi.string().optional(),
    tone: Joi.string().optional(),
    length: Joi.string().optional(),
    aiModel: Joi.string().optional(),
    customInstructions: Joi.array().items(Joi.string()).optional()
  }).required()
});

// Get user settings
router.get('/settings', authenticateUser, async (req: Request, res: Response<ApiResponse<{ settings: UserSettings }>>) => {
  try {
    const db = getFirestore();
    const userId = req.user!.uid;
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      // Create default settings for new user
      const defaultSettings: UserSettings = {
        language: 'auto',
        tone: 'auto',
        length: 'auto',
        aiModel: 'default',
        customInstructions: ['Less AI, more human'],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await db.collection('users').doc(userId).set(defaultSettings);
      
      logger.info('Created default user settings', { userId });
      
      return res.json({
        success: true,
        data: {
          settings: defaultSettings
        }
      });
    }
    
    const userData = userDoc.data() as UserSettings;
    
    res.json({
      success: true,
      data: {
        settings: userData
      }
    });
  } catch (error) {
    logger.error('Failed to get user settings', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user settings'
    });
  }
});

// Update user settings
router.put('/settings', authenticateUser, async (req: Request<{}, ApiResponse<{ settings: UserSettings }>, UpdateSettingsRequest>, res: Response<ApiResponse<{ settings: UserSettings }>>) => {
  try {
    // Validate request body
    const { error, value } = updateSettingsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details.map(d => d.message).join(', ')
      });
    }

    const db = getFirestore();
    const userId = req.user!.uid;
    const { settings } = value;
    
    // Get current settings
    const userDoc = await db.collection('users').doc(userId).get();
    let currentSettings: UserSettings;
    
    if (!userDoc.exists) {
      // Create new user with default settings
      currentSettings = {
        language: 'auto',
        tone: 'auto',
        length: 'auto',
        aiModel: 'default',
        customInstructions: ['Less AI, more human'],
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } else {
      currentSettings = userDoc.data() as UserSettings;
    }
    
    // Update settings
    const updatedSettings: UserSettings = {
      ...currentSettings,
      ...settings,
      updatedAt: new Date()
    };
    
    await db.collection('users').doc(userId).set(updatedSettings);
    
    logger.info('User settings updated', { userId, updatedFields: Object.keys(settings) });
    
    res.json({
      success: true,
      data: {
        settings: updatedSettings
      }
    });
  } catch (error) {
    logger.error('Failed to update user settings', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update user settings'
    });
  }
});

// Get user profile
router.get('/profile', authenticateUser, async (req: Request, res: Response<ApiResponse<{ user: User }>>) => {
  try {
    const user = req.user!;
    
    res.json({
      success: true,
      data: {
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          picture: user.picture
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get user profile', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user profile'
    });
  }
});

// Delete user account
router.delete('/account', authenticateUser, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const db = getFirestore();
    const userId = req.user!.uid;
    
    // Delete user data from Firestore
    await db.collection('users').doc(userId).delete();
    
    // Delete usage logs
    const usageQuery = db.collection('usage_logs').where('userId', '==', userId);
    const usageSnapshot = await usageQuery.get();
    
    const batch = db.batch();
    usageSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    logger.info('User account deleted', { userId });
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete user account', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
});

export default router;
