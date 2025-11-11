import { EmailContextInput, EmailContextPayload, EmailMetadata } from '../types';

const EMAIL_DELIMITER = '\n\n--- Email Separator ---\n\n';

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractPayload = (value: unknown): EmailContextPayload | null => {
  if (!value) {
    return null;
  }

  if (isPlainObject(value)) {
    if ('markdown' in value || 'plainText' in value || 'metadata' in value) {
      return value as EmailContextPayload;
    }

    if ('emailContent' in value) {
      return extractPayload((value as { emailContent?: unknown }).emailContent);
    }
  }

  return null;
};

const formatMetadata = (metadata?: EmailMetadata | null): string => {
  if (!metadata) {
    return '';
  }

  const lines: string[] = [];

  const senderParts: string[] = [];
  if (metadata.senderName) senderParts.push(metadata.senderName);
  if (metadata.senderEmail) senderParts.push(`<${metadata.senderEmail}>`);
  if (senderParts.length) {
    lines.push(`From: ${senderParts.join(' ')}`.trim());
  }

  if (metadata.subject) {
    lines.push(`Subject: ${metadata.subject}`);
  }

  if (metadata.sentAt) {
    lines.push(`Date: ${metadata.sentAt}`);
  }

  if (metadata.threadId) {
    lines.push(`Thread ID: ${metadata.threadId}`);
  }

  if (metadata.messageId) {
    lines.push(`Message ID: ${metadata.messageId}`);
  }

  return lines.join('\n').trim();
};

const formatPayload = (payload: EmailContextPayload | null): string => {
  if (!payload) {
    return '';
  }

  const sections: string[] = [];

  const metadataSection = formatMetadata(payload.metadata);
  if (metadataSection) {
    sections.push(metadataSection);
  }

  const content = payload.markdown?.trim() || payload.plainText?.trim() || '';
  if (content) {
    sections.push(content);
  }

  return sections.join('\n\n').trim();
};

export const formatEmailContext = (context: EmailContextInput): string => {
  if (!context) {
    return '';
  }

  if (typeof context === 'string') {
    return context.trim();
  }

  if (Array.isArray(context)) {
    const segments = context
      .map(entry => formatPayload(extractPayload(entry)))
      .filter(segment => segment.length > 0);
    return segments.join(EMAIL_DELIMITER).trim();
  }

  return formatPayload(extractPayload(context));
};

