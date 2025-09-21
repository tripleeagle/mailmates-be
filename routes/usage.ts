import express, { Request, Response, NextFunction } from 'express';
import { verifyIdToken, getFirestore } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse, UsageData } from '../types';

const router = express.Router();

interface LogUsageRequest extends UsageData {}

interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  averageResponseTime: number;
  requestsByModel: { [model: string]: number };
  requestsByType: { [type: string]: number };
  requestsByLanguage: { [language: string]: number };
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

// Log usage endpoint
router.post('/log', authenticateUser, async (req: Request<{}, ApiResponse, LogUsageRequest>, res: Response<ApiResponse>) => {
  try {
    const {
      type,
      model,
      language,
      tone,
      length,
      promptLength,
      responseLength,
      tokensUsed,
      processingTime
    } = req.body;

    const db = getFirestore();
    const userId = req.user!.uid;
    
    const usageRecord = {
      userId,
      timestamp: new Date(),
      type,
      model,
      language,
      tone,
      length,
      promptLength,
      responseLength,
      tokensUsed,
      processingTime
    };

    await db.collection('usage_logs').add(usageRecord);
    
    logger.info('Usage logged successfully', { userId, type, model });
    
    res.json({
      success: true,
      message: 'Usage logged successfully'
    });
  } catch (error) {
    logger.error('Failed to log usage', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to log usage'
    });
  }
});

// Get usage statistics
router.get('/stats', authenticateUser, async (req: Request, res: Response<ApiResponse<{ stats: UsageStats }>>) => {
  try {
    const db = getFirestore();
    const userId = req.user!.uid;
    
    // Get all usage logs for the user
    const usageQuery = db.collection('usage_logs')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc');
    
    const usageSnapshot = await usageQuery.get();
    
    if (usageSnapshot.empty) {
      return res.json({
        success: true,
        data: {
          stats: {
            totalRequests: 0,
            totalTokens: 0,
            averageResponseTime: 0,
            requestsByModel: {},
            requestsByType: {},
            requestsByLanguage: {}
          }
        }
      });
    }
    
    const usageData = usageSnapshot.docs.map(doc => doc.data());
    
    // Calculate statistics
    const stats: UsageStats = {
      totalRequests: usageData.length,
      totalTokens: usageData.reduce((sum, record) => sum + (record.tokensUsed?.total || 0), 0),
      averageResponseTime: usageData.reduce((sum, record) => sum + (record.processingTime || 0), 0) / usageData.length,
      requestsByModel: {},
      requestsByType: {},
      requestsByLanguage: {}
    };
    
    // Count by model, type, and language
    usageData.forEach(record => {
      // Count by model
      if (record.model) {
        stats.requestsByModel[record.model] = (stats.requestsByModel[record.model] || 0) + 1;
      }
      
      // Count by type
      if (record.type) {
        stats.requestsByType[record.type] = (stats.requestsByType[record.type] || 0) + 1;
      }
      
      // Count by language
      if (record.language) {
        stats.requestsByLanguage[record.language] = (stats.requestsByLanguage[record.language] || 0) + 1;
      }
    });
    
    logger.info('Usage stats retrieved', { userId, totalRequests: stats.totalRequests });
    
    res.json({
      success: true,
      data: {
        stats
      }
    });
  } catch (error) {
    logger.error('Failed to get usage stats', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve usage statistics'
    });
  }
});

// Get recent usage logs
router.get('/recent', authenticateUser, async (req: Request, res: Response<ApiResponse<{ logs: any[] }>>) => {
  try {
    const db = getFirestore();
    const userId = req.user!.uid;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const usageQuery = db.collection('usage_logs')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit);
    
    const usageSnapshot = await usageQuery.get();
    
    const logs = usageSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    logger.info('Recent usage logs retrieved', { userId, count: logs.length });
    
    res.json({
      success: true,
      data: {
        logs
      }
    });
  } catch (error) {
    logger.error('Failed to get recent usage logs', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent usage logs'
    });
  }
});

export default router;
