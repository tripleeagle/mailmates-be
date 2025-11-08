// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createApp } from '../app';

const app = createApp({
  startupLogMessage: 'Starting AI Email Assistant Backend (Vercel)',
  startupLogContext: {
    environment: process.env.NODE_ENV || 'production',
    feUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
});

export default app;