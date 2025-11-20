import winston from 'winston';
import type { firestore } from 'firebase-admin';
import { LogContext } from '../types';

const isVercel = Boolean(process.env.VERCEL);
const isTestEnv = process.env.NODE_ENV === 'test';
// Firebase logging is disabled by default - set ENABLE_FIREBASE_LOGGING=true to enable
const enableFirebaseLogging = process.env.ENABLE_FIREBASE_LOGGING === 'true';

// Custom format for console output (local/dev)
const localConsoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }

    if (stack) {
      log += `\n${stack}`;
    }

    return log;
  })
);

// JSON-friendly format for Vercel logging
const vercelConsoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const payload: Record<string, unknown> = {
      timestamp,
      level,
      message,
    };

    if (stack) {
      payload.stack = stack;
    }

    if (Object.keys(meta).length > 0) {
      payload.meta = meta;
    }

    return JSON.stringify(payload);
  })
);

const consoleFormat = isVercel ? vercelConsoleFormat : localConsoleFormat;

// Create transports - console only
const transports = [
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
    const trimmed = message.trim();
    if (!trimmed) return;

    if (isVercel) {
      logger.info(trimmed);
    } else {
      logger.http(trimmed);
    }
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
if (!isTestEnv) {
  process.on('uncaughtException', (error: Error) => {
    extendedLogger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    if (!isVercel) {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    extendedLogger.error('Unhandled Rejection', { reason, promise });
    if (!isVercel) {
      process.exit(1);
    }
  });
}

export type { ExtendedLogger };
export { extendedLogger };

interface FirebaseLogWriterOptions {
  collectionName?: string;
  transformContext?: (context: LogContext) => Record<string, unknown>;
}

interface FirebaseLogEntry {
  level: string;
  message: string;
  context: Record<string, unknown>;
  timestamp: Date;
  environment: {
    nodeEnv?: string;
    vercel?: boolean;
    logLevel: string;
  };
}

export class FirebaseLogWriter {
  private firestore: firestore.Firestore | null | undefined;
  private readonly collectionName: string;
  private readonly transformContext?: (context: LogContext) => Record<string, unknown>;

  constructor(
    private readonly provider: ExtendedLogger,
    options: FirebaseLogWriterOptions = {}
  ) {
    this.collectionName = options.collectionName ?? 'logs';
    this.transformContext = options.transformContext;
  }

  async log(level: string, message: string, context: LogContext = {}): Promise<void> {
    this.provider.log(level, message, context);

    // Skip Firebase logging if disabled
    if (!enableFirebaseLogging) {
      return;
    }

    try {
      const firestore = await this.getFirestore();
      if (!firestore) {
        return;
      }

      const entry: FirebaseLogEntry = {
        level,
        message,
        context: this.transformContext ? this.transformContext(context) : this.sanitizeContext(context),
        timestamp: new Date(),
        environment: {
          nodeEnv: process.env.NODE_ENV,
          vercel: isVercel,
          logLevel: process.env.LOG_LEVEL || 'info',
        },
      };

      const docId = this.generateDocumentId(level);
      await firestore.collection(this.collectionName).doc(docId).set(entry);
    } catch (error) {
      this.provider.error('FirebaseLogWriter failed to write log', {
        level,
        message,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getFirestore(): Promise<firestore.Firestore | null> {
    if (this.firestore !== undefined) {
      return this.firestore;
    }

    try {
      const firebaseModule = await import('./firebase');
      if (typeof firebaseModule.initializeFirebase === 'function') {
        firebaseModule.initializeFirebase();
      }
      this.firestore = firebaseModule.getFirestore?.() ?? null;
    } catch (error) {
      this.firestore = null;
      this.provider.warn('FirebaseLogWriter disabled - unable to access Firestore', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.firestore;
  }

  private sanitizeContext(context: LogContext): Record<string, unknown> {
    try {
      return JSON.parse(JSON.stringify(context));
    } catch {
      return { raw: String(context) };
    }
  }

  private generateDocumentId(level: string): string {
    const environment =
      process.env.APP_ENV ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV ||
      'unknown';

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const randomSuffix = Math.random().toString(36).slice(2, 10);

    return `${environment}-${timestamp}-${level}-${randomSuffix}`.toLowerCase();
  }
}

const firebaseWriter = new FirebaseLogWriter(extendedLogger);

const levelMethods = new Set([
  'error',
  'warn',
  'info',
  'http',
  'verbose',
  'debug',
  'silly',
]);

// Create Firebase logger proxy that conditionally logs to Firebase based on enableFirebaseLogging
const firebaseLogger = new Proxy(extendedLogger, {
  get(target, prop, receiver) {
    const original = Reflect.get(target, prop, receiver);

    if (typeof prop === 'string' && typeof original === 'function') {
      if (prop === 'log') {
        return (...args: unknown[]) => {
          const normalized = normalizeLogArgs(args);
          if (normalized && enableFirebaseLogging) {
            void firebaseWriter.log(normalized.level, normalized.message, normalized.context);
          }
          return original.apply(target, args);
        };
      }

      if (levelMethods.has(prop)) {
        return (...args: unknown[]) => {
          const normalized = normalizeLevelArgs(prop, args);
          if (normalized && enableFirebaseLogging) {
            void firebaseWriter.log(normalized.level, normalized.message, normalized.context);
          }
          return original.apply(target, args);
        };
      }
    }

    return original;
  },
}) as ExtendedLogger;

function normalizeLevelArgs(level: string, args: unknown[]): { level: string; message: string; context: LogContext } | null {
  if (!args.length) {
    return null;
  }

  const [first, second] = args;
  const context: LogContext = isPlainObject(second) ? { ...second as LogContext } : {};

  if (typeof first === 'string') {
    return { level, message: first, context };
  }

  if (first instanceof Error) {
    return {
      level,
      message: first.message,
      context: {
        ...context,
        error: first.message,
        stack: first.stack,
      },
    };
  }

  if (isPlainObject(first)) {
    const payload = first as Record<string, unknown>;
    const message = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload);
    return { level, message, context: { ...context, ...payload } };
  }

  return {
    level,
    message: String(first),
    context,
  };
}

function normalizeLogArgs(args: unknown[]): { level: string; message: string; context: LogContext } | null {
  if (!args.length) {
    return null;
  }

  if (typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    const payload = args[0] as Record<string, unknown>;
    const level = typeof payload.level === 'string' ? payload.level : (payload['level'] as string | undefined) ?? 'info';
    const message = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload);
    const context = { ...payload };
    delete context.level;
    delete context.message;
    return { level, message, context };
  }

  if (typeof args[0] === 'string') {
    const level = args[0] as string;
    const message = typeof args[1] === 'string' ? args[1] : String(args[1] ?? '');
    const context = isPlainObject(args[2]) ? { ...(args[2] as LogContext) } : {};
    return { level, message, context };
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { firebaseLogger };
export default firebaseLogger;