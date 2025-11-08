// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import express, { Request, Response, Application } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import corsHandler from './middleware/corsHandler';

// Import logger
import logger from './config/logger';

import authRoutes from './api/auth';
import generateRoutes from './api/generate';
import userRoutes from './api/user';
import usageRoutes from './api/usage';
import paymentRoutes from './api/payment';
import { initializeFirebaseWithValidation } from './config/firebase';
import { errorHandler } from './middleware/errorHandler';

const app: Application = express();
const PORT: string | number = process.env.PORT || 5100;

// Trust proxy for proper rate limiting behind reverse proxies (Vercel, etc.)
app.set('trust proxy', 1);

// Log server startup
logger.info('Starting AI Email Assistant Backend', {
  port: PORT,
  environment: process.env.NODE_ENV || 'development',
  version: process.env.npm_package_version || '1.0.0',
  feUrl: process.env.FRONTEND_URL
});

// Initialize Firebase with validation
const initializeApp = async (): Promise<void> => {
  try {
    const firebaseApp = await initializeFirebaseWithValidation();
    
    if (!firebaseApp) {
      logger.error('Critical: Firebase initialization failed. Server will start but authentication features will be unavailable.', {
        error: 'Firebase initialization returned null',
        impact: 'Authentication and user management features will not work'
      });
      
      // In production, you might want to exit here
      if (process.env.NODE_ENV === 'production') {
        logger.error('Exiting due to Firebase initialization failure in production environment');
        process.exit(1);
      }
    } else {
      logger.info('Firebase initialization successful - all services are ready');
    }
  } catch (error) {
    logger.error('Critical: Firebase initialization threw an exception', {
      error: (error as Error).message,
      stack: (error as Error).stack,
      impact: 'Authentication and user management features will not work'
    });
    
    // In production, exit on Firebase initialization failure
    if (process.env.NODE_ENV === 'production') {
      logger.error('Exiting due to Firebase initialization exception in production environment');
      process.exit(1);
    }
  }
};

// Initialize Firebase before setting up routes
initializeApp();

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // Default: 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '500', 10), // Default: 500 requests per window
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS handling
app.use('/api', corsHandler);

app.use('/api/', limiter);

// Body parsing middleware (exclude webhook routes that need raw body)
app.use((req, res, next) => {
  // Skip JSON parsing for Stripe webhook
  if (req.path === '/api/payment/webhook') {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware - Morgan handles HTTP request logging
app.use(morgan('combined', { stream: logger.stream }));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const { getFirebaseApp } = require('./config/firebase');
  const firebaseApp = getFirebaseApp();
  
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    services: {
      firebase: firebaseApp ? 'connected' : 'disconnected',
      firestore: firebaseApp ? 'available' : 'unavailable'
    }
  };

  // Return 503 if critical services are down in production
  if (process.env.NODE_ENV === 'production' && !firebaseApp) {
    return res.status(503).json({
      ...healthStatus,
      status: 'unhealthy',
      message: 'Critical services unavailable'
    });
  }

  res.json(healthStatus);
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/user', userRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/payment', paymentRoutes);

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info('Server started successfully', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    healthCheck: `http://localhost:${PORT}/health`,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;
