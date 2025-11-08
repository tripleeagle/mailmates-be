import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'chrome-extension://*',
  'https://mail.google.com',
  'https://test.mailmates.app',
  'https://mailmates.app'
];

const corsHandler = (req: Request, res: Response, next: NextFunction): void => {
  const origin = req.headers.origin;
  const isAllowedOrigin = origin !== undefined && allowedOrigins.includes(origin);
  logger.error('CORS: ', {
    origin,
    isAllowedOrigin,
    allowedOrigins
  });

  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    res.header('Vary', 'Origin');
  }

  if (isAllowedOrigin && origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    res.header('Access-Control-Allow-Origin', 'null');
  }

  if (req.method === 'OPTIONS') {
    logger.error('Ending OPTIONS request');
    res.status(200).end();
    return;
  }

  next();
};

export default corsHandler;