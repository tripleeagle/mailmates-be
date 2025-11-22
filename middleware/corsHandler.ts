import { Request, Response, NextFunction } from 'express';

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://mail.google.com',
  'https://test.mailmates.app',
  'https://mailmates.app',
  'https://www.mailmates.app'
];

/**
 * Check if origin is allowed
 * Chrome extensions have dynamic IDs, so we check if origin starts with 'chrome-extension://'
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  // Allow all chrome-extension:// origins
  if (origin.startsWith('chrome-extension://')) {
    return true;
  }

  // Check exact match for web origins
  return allowedOrigins.includes(origin);
}

const corsHandler = (req: Request, res: Response, next: NextFunction): void => {
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(origin);

  if (req.method === 'OPTIONS') {
    // Preflight request
    if (allowed && origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Max-Age', '86400');
    }
    res.header('Vary', 'Origin');
    res.status(200).end();
    return;
  }

  // Actual request
  if (allowed && origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Vary', 'Origin');

  next();
};

export default corsHandler;