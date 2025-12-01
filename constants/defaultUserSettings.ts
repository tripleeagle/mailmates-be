import { AISettings } from '../types';

/**
 * Default settings for new users
 * These settings are applied when a user is first created
 */
export const DEFAULT_USER_SETTINGS: Partial<AISettings> = {
  // Screen 1 - Identity & Basics
  userName: undefined,
  defaultGreeting: undefined,
  preferredClosing: undefined,
  jobTitleOrCompany: undefined,

  // Screen 2 - Tone and Writing Structure
  emailLength: 'auto',
  emailTone: 'auto',
  customTones: [],

  // Screen 3 - Formatting & Style
  formattingPreferences: [],
  customFormattings: [],
  writingStylePreferences: [],
  customWritingStyle: undefined,
  phrasesToAvoid: [],
  customPhraseToAvoid: undefined,

  // Screen 4 - Context & Language Behavior
  followUpEmailBehavior: 'Do not include previous context',
  defaultLanguage: 'auto',
  defaultSummaryLanguage: 'auto',
  languageDetection: 'Detect and switch automatically',

  // Screen 5 - Model & Custom Rules
  aiModel: 'default',
  customInstructions: [
    'Do not use em dash (—)',
    'Less AI, more human'
  ],

  // Legacy fields (for backward compatibility)
  language: 'auto',
  tone: 'auto',
  length: 'auto'
};

