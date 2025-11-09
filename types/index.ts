import { Request, Response } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken;
    }
  }
}

// User types
export interface User {
  uid: string;
  email?: string;
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  picture?: string;
}

// AI Service types
export interface AISettings {
  language: string;
  tone: string;
  length: string;
  aiModel: string;
  customInstructions: string[];
}

export interface GenerateRequest {
  prompt: string;
  type: 'ai-assistant' | 'ai-reply';
  settings: AISettings;
  emailContext?: string;
  user?: User;
}

export interface AIResponse {
  subject: string;
  body: string;
  model: string;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  processingTime: number;
}

// Usage tracking types
export interface UsageData {
  type: string;
  model: string;
  language: string;
  tone: string;
  length: string;
  promptLength: number;
  responseLength: number;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  processingTime: number;
}

export interface UsageRecord extends UsageData {
  userId: string;
  timestamp: Date;
}

// Logger types
export interface LogContext {
  [key: string]: any;
}

export interface AuthLogData {
  action: string;
  userId: string;
  success: boolean;
  details?: LogContext;
}

export interface AILogData {
  provider: string;
  action: string;
  userId: string;
  tokens: {
    input?: number;
    output?: number;
    total?: number;
  };
  duration?: number;
}

export interface SecurityLogData {
  event: string;
  details?: LogContext;
}

export interface PerformanceLogData {
  operation: string;
  duration: number;
  details?: LogContext;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  metadata?: {
    [key: string]: any;
  };
}

// Error types
export interface AppError extends Error {
  status?: number;
  code?: string;
  type?: string;
}

// Environment variables type
export interface EnvConfig {
  PORT: string;
  NODE_ENV: string;
  FRONTEND_URL: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_PRIVATE_KEY_ID: string;
  FIREBASE_PRIVATE_KEY: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_CLIENT_ID: string;
  FIREBASE_STORAGE_BUCKET: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_AI_API_KEY: string;
  LLAMA_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  RATE_LIMIT_WINDOW_MS: string;
  RATE_LIMIT_MAX_REQUESTS: string;
}
