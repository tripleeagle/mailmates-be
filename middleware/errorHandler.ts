import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { AppError } from '../types';

interface ErrorResponse {
  message: string;
  status: number;
}

const errorHandler = (err: AppError, req: Request, res: Response, next: NextFunction): void => {
  // Log the error with context
  logger.logError(err, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userId: req.user?.uid || 'anonymous',
    userAgent: req.get('User-Agent'),
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // Default error
  let error: ErrorResponse = {
    message: err.message || 'Internal Server Error',
    status: err.status || 500
  };

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values((err as any).errors).map((val: any) => val.message).join(', ');
    error = {
      message: `Validation Error: ${message}`,
      status: 400
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      message: 'Invalid token',
      status: 401
    };
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      message: 'Token expired',
      status: 401
    };
  }

  // Firebase errors
  if (err.code && err.code.startsWith('auth/')) {
    error = {
      message: 'Authentication error',
      status: 401
    };
  }

  // OpenAI API errors
  if (err.type === 'insufficient_quota') {
    error = {
      message: 'API quota exceeded',
      status: 429
    };
  }

  // Rate limiting errors
  if (err.status === 429) {
    error = {
      message: 'Too many requests',
      status: 429
    };
  }

  res.status(error.status).json({
    success: false,
    error: error.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export { errorHandler };
