// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import express, { Request, Response, Application } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Import logger
import logger from '../config/logger';

import authRoutes from './auth';
import generateRoutes from './generate';
import userRoutes from './user';
import usageRoutes from './usage';
import paymentRoutes from './payment';
import { initializeFirebase } from '../config/firebase';
import { errorHandler } from '../middleware/errorHandler';

const app: Application = express();

// Trust proxy for proper rate limiting behind reverse proxies (Vercel, etc.)
app.set('trust proxy', 1);

// Initialize Firebase
initializeFirebase();

// Log server startup
logger.info('Starting AI Email Assistant Backend (Vercel)', {
  environment: process.env.NODE_ENV || 'production',
  version: process.env.npm_package_version || '1.0.0',
  feUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
});

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

const origins = [
  'chrome-extension://*',
  'https://mail.google.com',
  process.env.FRONTEND_URL || 'http://localhost:3000'
];
logger.info('CORS origins: ', origins);

// CORS configuration
const corsOptions: CorsOptions = {
  origin: origins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

const corsMiddleware = cors(corsOptions);

app.use((req, res, next) => {
  corsMiddleware(req, res, (err) => {
    if (err) {
      logger.error('CORS request failed', {
        error: err.message,
        origin: req.headers.origin,
        method: req.method,
        path: req.originalUrl
      });
      return next(err);
    }
    return next();
  });
});

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
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
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

// Export the app for Vercel
export default app;