import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import corsHandler from './middleware/corsHandler';
import { errorHandler } from './middleware/errorHandler';
import logger from './config/logger';
import { initializeFirebaseWithValidation, getFirebaseApp } from './config/firebase';
import authRoutes from './api/auth';
import generateRoutes from './api/generate';
import userRoutes from './api/user';
import usageRoutes from './api/usage';
import paymentRoutes from './api/payment';

type HealthCheckMode = 'simple' | 'detailed';

interface CreateAppOptions {
  healthCheckMode?: HealthCheckMode;
  startupLogMessage?: string;
  startupLogContext?: Record<string, unknown>;
}

const DEFAULT_HEALTH_MODE: HealthCheckMode = 'simple';

export function createApp(options: CreateAppOptions = {}): Application {
  const {
    healthCheckMode = DEFAULT_HEALTH_MODE,
    startupLogMessage = 'Starting AI Email Assistant Backend',
    startupLogContext = {},
  } = options;

  initializeFirebaseWithValidation();

  const app: Application = express();

  app.set('trust proxy', 1);

  logger.info(startupLogMessage, {
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    feUrl: process.env.FRONTEND_URL,
    ...startupLogContext,
  });

  app.use(morgan('combined', { stream: logger.stream }));

  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  }));

  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '500', 10),
    message: {
      error: 'Too many requests from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', corsHandler);
  app.use('/api/', limiter);

  app.use((req, res, next) => {
    if (req.path === '/api/payment/webhook') {
      return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
  });

  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(compression());

  if (healthCheckMode === 'detailed') {
    app.get('/health', (req: Request, res: Response) => {
      const firebaseApp = getFirebaseApp();

      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
          firebase: firebaseApp ? 'connected' : 'disconnected',
          firestore: firebaseApp ? 'available' : 'unavailable',
        },
      };

      if (process.env.NODE_ENV === 'production' && !firebaseApp) {
        return res.status(503).json({
          ...healthStatus,
          status: 'unhealthy',
          message: 'Critical services unavailable',
        });
      }

      return res.json(healthStatus);
    });
  } else {
    app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });
  }

  app.use('/api/auth', authRoutes);
  app.use('/api/generate', generateRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/usage', usageRoutes);
  app.use('/api/payment', paymentRoutes);

  app.use('*', (req: Request, res: Response) => {
    res.status(404).json({
      error: 'Endpoint not found',
      path: req.originalUrl,
      method: req.method,
    });
  });

  app.use(errorHandler);

  return app;
}

