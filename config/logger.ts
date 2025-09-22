import winston from 'winston';
import { LogContext } from '../types';

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// Create transports - console only
const transports = [
  // Console transport
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'info',
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true,
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: consoleFormat,
  transports,
  exitOnError: false,
});

// HTTP level is already handled by the main console transport

// Create a stream for Morgan HTTP logging
const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  }
};

// Extended logger interface
interface ExtendedLogger extends Omit<winston.Logger, 'stream'> {
  stream: { write: (message: string) => void };
  logAuth: (action: string, userId: string, success: boolean, details?: LogContext) => void;
  logAI: (provider: string, action: string, userId: string, tokens?: any, duration?: number | null) => void;
  logError: (error: Error, context?: LogContext) => void;
  logSecurity: (event: string, details?: LogContext) => void;
  logPerformance: (operation: string, duration: number, details?: LogContext) => void;
}

// Add custom methods for different types of logging
const extendedLogger = logger as unknown as ExtendedLogger;

extendedLogger.stream = stream;

// HTTP request logging is handled by Morgan middleware

extendedLogger.logAuth = (action: string, userId: string, success: boolean, details: LogContext = {}) => {
  extendedLogger.info('Authentication', {
    action,
    userId,
    success,
    ...details,
  });
};

extendedLogger.logAI = (provider: string, action: string, userId: string, tokens: any = {}, duration: number | null = null) => {
  extendedLogger.info('AI Service', {
    provider,
    action,
    userId,
    tokens,
    duration: duration ? `${duration}ms` : null,
  });
};

extendedLogger.logError = (error: Error, context: LogContext = {}) => {
  extendedLogger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    ...context,
  });
};

extendedLogger.logSecurity = (event: string, details: LogContext = {}) => {
  extendedLogger.warn('Security Event', {
    event,
    ...details,
  });
};

extendedLogger.logPerformance = (operation: string, duration: number, details: LogContext = {}) => {
  extendedLogger.info('Performance', {
    operation,
    duration: `${duration}ms`,
    ...details,
  });
};

// Handle uncaught exceptions and unhandled rejections
if (process.env.NODE_ENV !== 'test') {
  process.on('uncaughtException', (error: Error) => {
    extendedLogger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    extendedLogger.error('Unhandled Rejection', { reason, promise });
    process.exit(1);
  });
}

export default extendedLogger;
