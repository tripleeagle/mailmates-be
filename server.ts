// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import logger from './config/logger';
import { createApp } from './app';
const PORT: string | number = process.env.PORT || 5100;

const app = createApp({
  healthCheckMode: 'detailed',
  startupLogMessage: 'Starting AI Email Assistant Backend',
  startupLogContext: {
    port: PORT,
  },
});

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
