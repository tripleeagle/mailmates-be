import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { verifyIdToken, getFirestore } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse, User, AISettings } from '../types';
import userService from '../services/userService';

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

const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  firstName: Joi.string().trim().max(100).allow('', null),
  lastName: Joi.string().trim().max(100).allow('', null)
}).or('name', 'firstName', 'lastName');

// Get user settings
router.get('/settings', authenticateUser, async (req: Request, res: Response<ApiResponse<{ settings: UserSettings }>>) => {
  try {
    const userId = req.user!.uid;
    const userEmail = req.user!.email;
    
    if (!userEmail) {
      logger.warn('User email not available in token', { userId });
      res.status(400).json({
        success: false,
        error: 'User email not available. Please log in again.'
      });
      return;
    }
    
    // Get user data using email
    const userData = await userService.getUserByEmail(userEmail);
    
    if (!userData) {
      // This shouldn't happen if user was properly stored during auth
      logger.warn('User not found in database', { userId, email: userEmail });
      res.status(404).json({
        success: false,
        error: 'User not found. Please log in again.'
      });
      return;
    }
    
    // Convert to UserSettings format (excluding profile fields)
    const settings: UserSettings = {
      language: userData.language,
      tone: userData.tone,
      length: userData.length,
      aiModel: userData.aiModel,
      customInstructions: userData.customInstructions,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt
    };
    
    res.json({
      success: true,
      data: {
        settings
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

    const userId = req.user!.uid;
    const userEmail = req.user!.email;
    const { settings } = value;
    
    if (!userEmail) {
      logger.warn('User email not available in token', { userId });
      res.status(400).json({
        success: false,
        error: 'User email not available. Please log in again.'
      });
      return;
    }
    
    // Get current user data using email
    const currentUser = await userService.getUserByEmail(userEmail);
    
    if (!currentUser) {
      logger.warn('User not found when updating settings', { userId, email: userEmail });
      res.status(404).json({
        success: false,
        error: 'User not found. Please log in again.'
      });
      return;
    }
    
    // Update settings
    const updatedSettings: UserSettings = {
      language: currentUser.language,
      tone: currentUser.tone,
      length: currentUser.length,
      aiModel: currentUser.aiModel,
      customInstructions: currentUser.customInstructions,
      createdAt: currentUser.createdAt,
      updatedAt: new Date(),
      ...settings
    };
    
    // Store updated settings using user service
    await userService.storeUser({
      uid: userId,
      email: currentUser.email,
      name: currentUser.name,
      picture: currentUser.picture
    } as any); // Type assertion needed due to DecodedIdToken interface
    
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
    const decodedUser = req.user!;
    const userEmail = decodedUser.email;

    if (!userEmail) {
      logger.warn('User email not available when fetching profile', { userId: decodedUser.uid });
      return res.status(400).json({
        success: false,
        error: 'User email not available. Please log in again.'
      });
    }

    const storedUser = await userService.getUserByEmail(userEmail);

    res.json({
      success: true,
      data: {
        user: {
          uid: decodedUser.uid,
          email: storedUser?.email ?? decodedUser.email,
          name: storedUser?.name ?? decodedUser.name,
          firstName: storedUser?.firstName ?? null,
          lastName: storedUser?.lastName ?? null,
          picture: storedUser?.picture ?? decodedUser.picture
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

// Update user profile
router.put('/profile', authenticateUser, async (req: Request, res: Response<ApiResponse<{ user: User }>>) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details.map((d) => d.message).join(', ')
      });
    }

    const userId = req.user!.uid;
    const userEmail = req.user!.email;

    if (!userEmail) {
      logger.warn('User email not available in token', { userId });
      return res.status(400).json({
        success: false,
        error: 'User email not available. Please log in again.'
      });
    }

    const rawName = value.name as string | undefined | null;
    const rawFirstName = value.firstName as string | undefined | null;
    const rawLastName = value.lastName as string | undefined | null;

    const trimmedName = rawName !== undefined && rawName !== null ? rawName.trim() : undefined;
    const trimmedFirstName = rawFirstName !== undefined && rawFirstName !== null ? rawFirstName.trim() : undefined;
    const trimmedLastName = rawLastName !== undefined && rawLastName !== null ? rawLastName.trim() : undefined;

    let normalizedFirstName: string | null | undefined =
      trimmedFirstName !== undefined ? (trimmedFirstName.length ? trimmedFirstName : null) : undefined;
    let normalizedLastName: string | null | undefined =
      trimmedLastName !== undefined ? (trimmedLastName.length ? trimmedLastName : null) : undefined;

    if (trimmedName) {
      const nameParts = trimmedName.split(/\s+/);
      const firstPart = nameParts.shift() || '';
      const remaining = nameParts.length ? nameParts.join(' ') : '';

      if (normalizedFirstName === undefined) {
        normalizedFirstName = firstPart.length ? firstPart : null;
      }
      if (normalizedLastName === undefined) {
        normalizedLastName = remaining.length ? remaining : null;
      }
    }

    const composedName = trimmedName && trimmedName.length
      ? trimmedName
      : [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ').trim();

    if (!composedName) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: 'Name cannot be empty.'
      });
    }

    const updatePayload: {
      firstName?: string | null;
      lastName?: string | null;
      name: string;
    } = { name: composedName };

    if (normalizedFirstName !== undefined) {
      updatePayload.firstName = normalizedFirstName;
    }

    if (normalizedLastName !== undefined) {
      updatePayload.lastName = normalizedLastName;
    }

    const updatedUser = await userService.updateUserProfileByEmail(userEmail, updatePayload);

    logger.info('User profile updated via API', {
      userId,
      email: userEmail
    });

    res.json({
      success: true,
      data: {
        user: {
          uid: updatedUser.uid,
          email: updatedUser.email,
          name: updatedUser.name,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          picture: updatedUser.picture
        }
      }
    });
  } catch (error) {
    logger.error('Failed to update user profile', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

// Delete user account
router.delete('/account', authenticateUser, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const db = getFirestore();
    const userId = req.user!.uid;
    const userEmail = req.user!.email;
    
    if (!userEmail) {
      logger.warn('User email not available in token', { userId });
      res.status(400).json({
        success: false,
        error: 'User email not available. Please log in again.'
      });
      return;
    }
    
    // Delete user data from Firestore using email
    const userQuery = await db.collection('users').where('email', '==', userEmail).limit(1).get();
    
    if (!userQuery.empty) {
      await userQuery.docs[0].ref.delete();
    }
    
    // Delete usage logs by email
    const usageQuery = db.collection('usage_logs').where('userId', '==', userId);
    const usageSnapshot = await usageQuery.get();
    
    const batch = db.batch();
    usageSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    logger.info('User account deleted', { userId, email: userEmail });
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete user account', {
      userId: req.user?.uid || 'unknown',
      email: req.user?.email || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
});

export default router;
