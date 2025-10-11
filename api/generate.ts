import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { verifyIdToken } from '../config/firebase';
import aiService from '../services/aiService';
import logger from '../config/logger';
import { GenerateRequest, ApiResponse, AIResponse, UsageData, User } from '../types';

const router = express.Router();

// Validation schemas
const generateSchema = Joi.object({
  prompt: Joi.string().min(1).max(2000).required(),
  type: Joi.string().valid('ai-assistant', 'ai-reply').required(),
  settings: Joi.object({
    language: Joi.string().required(),
    tone: Joi.string().required(),
    length: Joi.string().required(),
    aiModel: Joi.string().required(),
    customInstructions: Joi.array().items(Joi.string()).default([])
  }).required(),
  emailContext: Joi.string().allow(null, ''),
  user: Joi.object().allow(null)
});

interface SummarizeRequest {
  emailContent: string;
}

interface QuickReplyRequest {
  quickReplyType: string;
  emailContent: string;
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

// Generate email endpoint
router.post('/', authenticateUser, async (req: Request<{}, ApiResponse<{ email: { subject: string; body: string }; metadata: any }>, GenerateRequest>, res: Response<ApiResponse<{ email: { subject: string; body: string }; metadata: any }>>) => {
  try {
    // Validate request body
    const { error, value } = generateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details.map(d => d.message).join(', ')
      });
    }

    const { prompt, type, settings, emailContext } = value;
    const userId = req.user!.uid;

    logger.info('Email generation started', {
      userId,
      model: settings.aiModel,
      type,
      promptLength: prompt.length,
      hasContext: !!emailContext
    });

    const startTime = Date.now();
    // Generate email using AI service
    const result = await aiService.generateEmail(prompt, settings, emailContext);
    const processingTime = Date.now() - startTime;

    logger.logAI(settings.aiModel, 'email_generation', userId, {
      inputTokens: result.tokensUsed?.input || 0,
      outputTokens: result.tokensUsed?.output || 0,
      totalTokens: result.tokensUsed?.total || 0
    }, processingTime);

    // Log usage for analytics
    await logUsage(userId, {
      type,
      model: settings.aiModel,
      language: settings.language,
      tone: settings.tone,
      length: settings.length,
      promptLength: prompt.length,
      responseLength: result.body.length,
      tokensUsed: result.tokensUsed,
      processingTime: result.processingTime
    });

    res.json({
      success: true,
      data: {
        email: {
          subject: result.subject,
          body: result.body
        },
        metadata: {
          model: result.model,
          tokensUsed: result.tokensUsed,
          processingTime: result.processingTime
        }
      }
    });

  } catch (error) {
    logger.error('Email generation failed', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate email',
      message: (error as Error).message
    });
  }
});

// Summarize email endpoint
router.post('/summarize', authenticateUser, async (req: Request<{}, ApiResponse<{ summary: string }>, SummarizeRequest>, res: Response<ApiResponse<{ summary: string }>>) => {
  try {
    const { emailContent } = req.body;
    
    if (!emailContent || typeof emailContent !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Email content is required'
      });
    }

    const summary = await aiService.summarizeEmail(emailContent);

    logger.info('Email summarization completed', {
      userId: req.user!.uid,
      contentLength: emailContent.length
    });

    res.json({
      success: true,
      data: {
        summary
      }
    });

  } catch (error) {
    logger.error('Email summarization failed', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to summarize email',
      message: (error as Error).message
    });
  }
});

// Quick reply endpoint
router.post('/quick-reply', authenticateUser, async (req: Request<{}, ApiResponse<{ reply: string }>, QuickReplyRequest>, res: Response<ApiResponse<{ reply: string }>>) => {
  try {
    const { quickReplyType, emailContent } = req.body;
    
    if (!quickReplyType || typeof quickReplyType !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Quick reply type is required'
      });
    }

    if (!emailContent || typeof emailContent !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Email content is required'
      });
    }

    const reply = await aiService.generateQuickReply(quickReplyType, emailContent);

    logger.info('Quick reply generation completed', {
      userId: req.user!.uid,
      quickReplyType,
      contentLength: emailContent.length,
      replyLength: reply.length
    });

    res.json({
      success: true,
      data: {
        reply
      }
    });

  } catch (error) {
    logger.error('Quick reply generation failed', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate quick reply',
      message: (error as Error).message
    });
  }
});

// Log usage for analytics
async function logUsage(userId: string, usageData: UsageData): Promise<void> {
  try {
    const { getFirestore } = await import('../config/firebase');
    const db = getFirestore();
    
    const usageRecord = {
      userId,
      timestamp: new Date(),
      ...usageData
    };

    await db.collection('usage_logs').add(usageRecord);
    logger.info('Usage logged successfully', { userId, usageType: usageData.type });
  } catch (error) {
    logger.error('Failed to log usage', { userId, error: (error as Error).message });
    // Don't throw error for logging failures
  }
}

export default router;
