import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { verifyIdToken } from '../config/firebase';
import aiService from '../services/aiService';
import logger from '../config/logger';
import { GenerateRequest, ApiResponse, UsageData, EmailContextInput, AISettings } from '../types';
import usageTrackerService, { UsageConsumptionResult, PlanType } from '../services/usageTrackerService';
import userService, { StoredUser } from '../services/userService';
import { formatEmailContext } from '../utils/emailContext';

const router = express.Router();

// Validation schemas
const emailContextSchema = Joi.alternatives().try(
  Joi.string().allow('', null),
  Joi.object().unknown(true),
  Joi.array().items(Joi.object().unknown(true))
).allow(null);

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
  emailContext: emailContextSchema,
  user: Joi.object().allow(null)
});

const summarizeSchema = Joi.object({
  emailContent: emailContextSchema.required()
});

const quickReplySchema = Joi.object({
  quickReplyType: Joi.string().min(1).required(),
  emailContent: emailContextSchema.required(),
  settings: Joi.object({
    language: Joi.string().allow('', null),
    tone: Joi.string().allow('', null),
    length: Joi.string().allow('', null),
    aiModel: Joi.string().allow('', null),
    customInstructions: Joi.array().items(Joi.string()).default([]),
    mode: Joi.string().allow('', null)
  }).optional()
});

interface SummarizeRequest {
  emailContent: EmailContextInput;
}

interface QuickReplyRequest {
  quickReplyType: string;
  emailContent: EmailContextInput;
  settings?: Partial<AISettings> & { mode?: string | null };
}

type QuickReplySettingsPayload = Partial<AISettings> & { mode?: string };

const sanitizeSettingValue = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeCustomInstructions = (instructions?: string[] | null): string[] => {
  if (!Array.isArray(instructions)) {
    return [];
  }

  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const instruction of instructions) {
    if (typeof instruction !== 'string') {
      continue;
    }
    const trimmed = instruction.trim();
    if (!trimmed) {
      continue;
    }
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    sanitized.push(trimmed);
  }

  return sanitized;
};

const sanitizeQuickReplySettings = (
  settings?: Partial<AISettings> & { mode?: string | null }
): QuickReplySettingsPayload | undefined => {
  if (!settings) {
    return undefined;
  }

  const sanitized: QuickReplySettingsPayload = {
    language: sanitizeSettingValue(settings.language),
    tone: sanitizeSettingValue(settings.tone),
    length: sanitizeSettingValue(settings.length),
    aiModel: sanitizeSettingValue(settings.aiModel),
    customInstructions: sanitizeCustomInstructions(settings.customInstructions),
    mode: sanitizeSettingValue(settings.mode)
  };

  const hasAnySetting =
    sanitized.language ||
    sanitized.tone ||
    sanitized.length ||
    sanitized.aiModel ||
    sanitized.mode ||
    (sanitized.customInstructions && sanitized.customInstructions.length > 0);

  return hasAnySetting ? sanitized : undefined;
};

const extractUserQuickReplySettings = (user: StoredUser): QuickReplySettingsPayload => {
  const rawMode = (user as any)?.mode ?? (user as any)?.quickReplyMode;
  return {
    language: 'auto',
    tone: sanitizeSettingValue(user.tone) ?? 'auto',
    length: sanitizeSettingValue(user.length) ?? 'auto',
    aiModel: sanitizeSettingValue(user.aiModel) ?? 'gpt-5-nano',
    customInstructions: sanitizeCustomInstructions(user.customInstructions),
    mode: sanitizeSettingValue(rawMode)
  };
};

const mergeQuickReplySettings = (
  userSettings?: QuickReplySettingsPayload,
  requestSettings?: QuickReplySettingsPayload
): QuickReplySettingsPayload | undefined => {
  if (!userSettings && !requestSettings) {
    return undefined;
  }

  const combinedCustomInstructions = [
    ...(userSettings?.customInstructions ?? []),
    ...(requestSettings?.customInstructions ?? [])
  ];

  const uniqueCustomInstructions = sanitizeCustomInstructions(combinedCustomInstructions);

  return {
    language: requestSettings?.language ?? userSettings?.language ?? 'auto',
    tone: requestSettings?.tone ?? userSettings?.tone ?? 'auto',
    length: requestSettings?.length ?? userSettings?.length ?? 'auto',
    aiModel: requestSettings?.aiModel ?? userSettings?.aiModel ?? 'gpt-5-nano',
    customInstructions: uniqueCustomInstructions,
    mode: requestSettings?.mode ?? userSettings?.mode
  };
};

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
    const requestedAt = new Date();

    const planType = await getUserPlanType(userId);

    const usageAttempt = await usageTrackerService.consumeUsage(userId, planType, settings.aiModel, requestedAt);

    if (!usageAttempt.allowed) {
      res.status(429).json({
        success: false,
        error: 'Usage limit reached',
        message: buildLimitMessage(planType, usageAttempt),
        metadata: {
          usage: usageAttempt,
          resetNotice: 'Usage limits reset on the 1st day of each month or immediately after purchasing a subscription again.',
        },
      });
      return;
    }

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

    // Log usage for analytics (separate from quota tracking)
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
          processingTime: result.processingTime,
          usage: usageAttempt
        }
      }
    });

  } catch (error) {
    const userId = req.user?.uid;
    const model = req.body?.settings?.aiModel;
    if (userId && model) {
      try {
        await usageTrackerService.rollbackUsage(userId, model, new Date());
      } catch (rollbackError) {
        logger.error('Failed to rollback usage after generation error', {
          userId,
          model,
          error: (rollbackError as Error).message
        });
      }
    }
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
    const { error, value } = summarizeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details.map(d => d.message).join(', ')
      });
    }

    const { emailContent } = value;

    const formattedContent = formatEmailContext(emailContent);
    if (!formattedContent) {
      return res.status(400).json({
        success: false,
        error: 'Email content is required'
      });
    }

    const userId = req.user!.uid;
    const requestedAt = new Date();
    const planType = await getUserPlanType(userId);
    const model = 'gpt-4o-mini';

    const usageAttempt = await usageTrackerService.consumeUsage(userId, planType, model, requestedAt);

    if (!usageAttempt.allowed) {
      res.status(429).json({
        success: false,
        error: 'Usage limit reached',
        message: buildLimitMessage(planType, usageAttempt),
        metadata: {
          usage: usageAttempt,
          resetNotice: 'Usage limits reset on the 1st day of each month or immediately after purchasing a subscription again.',
        },
      });
      return;
    }

    const summary = await aiService.summarizeEmail(emailContent);

    logger.info('Email summarization completed', {
      userId,
      contentLength: formattedContent.length
    });

    res.json({
      success: true,
      data: {
        summary
      },
      metadata: {
        usage: usageAttempt,
      }
    });

  } catch (error) {
    const userId = req.user?.uid;
    if (userId) {
      try {
        await usageTrackerService.rollbackUsage(userId, 'gpt-4o-mini', new Date());
      } catch (rollbackError) {
        logger.error('Failed to rollback usage after summarization error', {
          userId,
          error: (rollbackError as Error).message
        });
      }
    }
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
    const { error, value } = quickReplySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details.map(d => d.message).join(', ')
      });
    }

    const { quickReplyType, emailContent, settings } = value as QuickReplyRequest;

    const formattedContent = formatEmailContext(emailContent);
    if (!formattedContent) {
      return res.status(400).json({
        success: false,
        error: 'Email content is required'
      });
    }

    const userId = req.user!.uid;
    const requestedAt = new Date();
    const planType = await getUserPlanType(userId);
    const model = 'gpt-5-nano';

    const usageAttempt = await usageTrackerService.consumeUsage(userId, planType, model, requestedAt);

    if (!usageAttempt.allowed) {
      res.status(429).json({
        success: false,
        error: 'Usage limit reached',
        message: buildLimitMessage(planType, usageAttempt),
        metadata: {
          usage: usageAttempt,
          resetNotice: 'Usage limits reset on the 1st day of each month or immediately after purchasing a subscription again.',
        },
      });
      return;
    }

    const requestSettings = sanitizeQuickReplySettings(settings);

    let userRecord: StoredUser | null = null;
    let userSettings: QuickReplySettingsPayload | undefined;
    try {
      userRecord = await userService.getUser(userId);
      if (userRecord) {
        userSettings = extractUserQuickReplySettings(userRecord);
      }
    } catch (settingsError) {
      logger.error('Failed to load user settings for quick reply, using defaults', {
        userId,
        error: (settingsError as Error).message
      });
    }

    const quickReplySettings = mergeQuickReplySettings(userSettings, requestSettings);

    logger.debug('Quick reply settings resolved', {
      userId,
      hasUserSettings: !!userSettings,
      hasRequestSettings: !!requestSettings,
      effectiveSettings: quickReplySettings
    });

    const reply = await aiService.generateQuickReply(quickReplyType, emailContent, quickReplySettings);

    logger.info('Quick reply generation completed', {
      userId,
      quickReplyType,
      contentLength: formattedContent.length,
      replyLength: reply.length
    });

    res.json({
      success: true,
      data: {
        reply
      },
      metadata: {
        usage: usageAttempt,
      }
    });

  } catch (error) {
    const userId = req.user?.uid;
    if (userId) {
      try {
        await usageTrackerService.rollbackUsage(userId, 'gpt-5-nano', new Date());
      } catch (rollbackError) {
        logger.error('Failed to rollback usage after quick reply error', {
          userId,
          error: (rollbackError as Error).message
        });
      }
    }
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

async function getUserPlanType(userId: string): Promise<PlanType> {
  try {
    const userRecord = await userService.getUser(userId);
    const planType = usageTrackerService.resolvePlanType(userRecord?.subscription?.planType as string | undefined);
    return planType;
  } catch (error) {
    logger.error('Failed to resolve user plan type, defaulting to free', {
      userId,
      error: (error as Error).message
    });
    return 'free';
  }
}

function buildLimitMessage(planType: PlanType, usageAttempt: UsageConsumptionResult): string {
  const tierLabel = usageAttempt.tier === 'basic' ? 'basic' : 'advanced';
  const limit = usageAttempt.limit;
  const remaining = usageAttempt.remaining;
  const baseMessage = limit === null
    ? `You have reached the current usage limit for ${tierLabel} models on your ${planType} plan.`
    : `You have reached the ${tierLabel} model limit (${limit} per month) for your ${planType} plan.`;

  const resetMessage = 'Usage resets on the 1st day of each month. Purchasing a subscription again immediately resets your usage counters.';

  if (remaining !== null && remaining > 0) {
    return `${baseMessage} You have ${remaining} remaining requests this month.`;
  }

  return `${baseMessage} ${resetMessage}`;
}

export default router;
