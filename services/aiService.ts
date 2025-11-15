import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../config/logger';
import { AISettings, AIResponse, EmailContextInput } from '../types';
import { formatEmailContext } from '../utils/emailContext';

interface AIProviderResponse {
  subject: string;
  body: string;
  tokensUsed?: {
    input?: number;
    output?: number;
    total?: number;
  };
  processingTime: number;
}

class AIService {
  private openai: OpenAI | null;
  private anthropic: Anthropic | null;
  private googleAI: GoogleGenerativeAI | null;

  constructor() {
    // Initialize AI services only if API keys are provided
    this.openai = process.env.OPENAI_API_KEY ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    }) : null;

    this.anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    }) : null;

    this.googleAI = process.env.GOOGLE_AI_API_KEY ? new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY) : null;
  }

  async generateEmail(prompt: string, settings: AISettings, emailContext?: EmailContextInput): Promise<AIResponse> {
    const model = settings.aiModel || 'default';
    
    try {
      let result: AIProviderResponse;
      
      switch (model.toLowerCase()) {
        case 'gpt-5-nano':
        case 'default':
          result = await this.generateWithOpenAI(prompt, settings, emailContext);
          break;
        case 'claude-3.5-sonnet':
        case 'claude-3.5':
        case 'claude':
          result = await this.generateWithClaude(prompt, settings, emailContext);
          break;
        case 'gemini-2.0':
        case 'gemini':
          result = await this.generateWithGemini(prompt, settings, emailContext);
          break;
        case 'llama-3.1':
        case 'llama':
          result = await this.generateWithLlama(prompt, settings, emailContext);
          break;
        case 'deepseek-v3':
        case 'deepseek':
          result = await this.generateWithDeepSeek(prompt, settings, emailContext);
          break;
        default:
          throw new Error(`Unsupported AI model: ${model}`);
      }

      return {
        subject: result.subject,
        body: result.body,
        model: model,
        tokensUsed: result.tokensUsed ? {
          input: result.tokensUsed.input || 0,
          output: result.tokensUsed.output || 0,
          total: result.tokensUsed.total || 0
        } : { input: 0, output: 0, total: 0 },
        processingTime: result.processingTime || 0
      };
    } catch (error) {
      logger.error(`AI generation error for model ${model}`, { 
        model, 
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw new Error(`Failed to generate email with ${model}: ${(error as Error).message}`);
    }
  }

  private async generateWithOpenAI(prompt: string, settings: AISettings, emailContext?: EmailContextInput): Promise<AIProviderResponse> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }
    
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(settings, emailContext);
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const processingTime = Date.now() - startTime;
    const content = response.choices[0].message.content;
    const parsedContent = JSON.parse(content!);

    return {
      subject: parsedContent.subject,
      body: parsedContent.body,
      tokensUsed: {
        input: response.usage?.prompt_tokens || 0,
        output: response.usage?.completion_tokens || 0,
        total: response.usage?.total_tokens || 0
      },
      processingTime
    };
  }

  private async generateWithClaude(prompt: string, settings: AISettings, emailContext?: EmailContextInput): Promise<AIProviderResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }
    
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(settings, emailContext);
    
    // Using type assertion since the SDK types may not be fully up to date
    const response = await (this.anthropic as any).messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        { role: 'user', content: prompt }
      ],
      system: systemPrompt
    });

    const processingTime = Date.now() - startTime;
    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsedContent = JSON.parse(content);

    return {
      subject: parsedContent.subject,
      body: parsedContent.body,
      tokensUsed: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
        total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      },
      processingTime
    };
  }

  private async generateWithGemini(prompt: string, settings: AISettings, emailContext?: EmailContextInput): Promise<AIProviderResponse> {
    if (!this.googleAI) {
      throw new Error('Google AI API key not configured');
    }
    
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(settings, emailContext);
    
    // Use gemini-2.0-flash-exp if available, otherwise fallback to gemini-1.5-pro
    const model = this.googleAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp'
    } as any);
    
    // Include system prompt in the user message
    const fullPrompt = `${systemPrompt}\n\nUser Request: ${prompt}`;
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const content = response.text();
    const parsedContent = JSON.parse(content);

    const processingTime = Date.now() - startTime;

    // Gemini 2.0 provides token usage information
    const usageMetadata = (response as any).usageMetadata;

    return {
      subject: parsedContent.subject,
      body: parsedContent.body,
      tokensUsed: { 
        input: usageMetadata?.promptTokenCount || 0, 
        output: usageMetadata?.candidatesTokenCount || 0, 
        total: usageMetadata?.totalTokenCount || 0 
      },
      processingTime
    };
  }

  private async generateWithLlama(prompt: string, settings: AISettings, emailContext?: EmailContextInput): Promise<AIProviderResponse> {
    // This would integrate with a Llama API service
    // For now, we'll use a fallback to OpenAI
    logger.warn('Llama 3.1 not yet implemented, falling back to OpenAI');
    return this.generateWithOpenAI(prompt, settings, emailContext);
  }

  private async generateWithDeepSeek(prompt: string, settings: AISettings, emailContext?: EmailContextInput): Promise<AIProviderResponse> {
    // This would integrate with DeepSeek API
    // For now, we'll use a fallback to OpenAI
    logger.warn('DeepSeek-V3.1 not yet implemented, falling back to OpenAI');
    return this.generateWithOpenAI(prompt, settings, emailContext);
  }

  private buildSystemPrompt(settings: AISettings, emailContext?: EmailContextInput): string {
    const { language, tone, length, customInstructions } = settings;
    
    let systemPrompt = `You are an AI email assistant. Generate professional emails based on user requests.

Requirements:
- Always respond with valid JSON in this exact format: {"subject": "Email Subject", "body": "Email Body"}
- Write in ${language === 'auto' ? 'the most appropriate language' : language}
- Use a ${tone === 'auto' ? 'professional' : tone} tone
- Make it ${length === 'auto' ? 'appropriately' : length} length
- Be professional, clear, and concise
- Include proper email formatting with greetings and closings`;

    const formattedContext = formatEmailContext(emailContext);
    if (formattedContext) {
      systemPrompt += `\n\nContext from the email being replied to:\n${formattedContext}`;
    }

    if (customInstructions && customInstructions.length > 0) {
      systemPrompt += `\n\nCustom Instructions:\n${customInstructions.join('\n')}`;
    }

    systemPrompt += `\n\nGenerate the email now:`;

    return systemPrompt;
  }

  async summarizeEmail(emailContent: EmailContextInput): Promise<string> {
    if (!this.openai) {
      throw new Error('Email summarization not available - OpenAI API key not configured.');
    }
    
    const formattedContent = formatEmailContext(emailContent);

    if (!formattedContent) {
      throw new Error('Email content is empty.');
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an email summarizer. Your task is to read the content of an email and generate a clear, concise summary of 1–3 sentences. Focus only on the main points, such as purpose, requests, key updates, or next steps. Exclude greetings, signatures, and unnecessary details. The summary should be neutral, factual, and easy to scan quickly.'
          },
          {
            role: 'user',
            content: formattedContent
          }
        ]
      });

      return response.choices[0].message.content?.trim() || 'Could not generate summary.';
    } catch (error) {
      logger.error('Email summarization error', { error: (error as Error).message });
      return 'Email content could not be summarized.';
    }
  }

  async generateQuickReply(
    quickReplyType: string,
    emailContent: EmailContextInput,
    userSettings?: Partial<AISettings> & { mode?: string | null }
  ): Promise<string> {
    if (!this.openai) {
      throw new Error('Quick reply generation not available - OpenAI API key not configured.');
    }
    
    const formattedContent = formatEmailContext(emailContent);

    if (!formattedContent) {
      throw new Error('Email content is empty.');
    }

    logger.info('Generating quick reply', { 
      quickReplyType, 
      contentLength: formattedContent.length 
    });

    try {
      const language = userSettings?.language ?? 'auto';
      const tone = userSettings?.tone ?? 'auto';
      const length = userSettings?.length ?? 'auto';
      const preferredModel = typeof userSettings?.aiModel === 'string' && userSettings.aiModel.trim().length > 0
        ? userSettings.aiModel.trim()
        : 'gpt-5-nano';
      const normalizedModel = preferredModel.toLowerCase() === 'default' ? 'gpt-5-nano' : preferredModel;
      const openAIModel = 'gpt-5-nano';
      if (normalizedModel.toLowerCase() !== openAIModel) {
        logger.warn('Quick reply model preference not supported, falling back to gpt-5-nano', {
          preferredModel: normalizedModel
        });
      }
      const mode = userSettings?.mode && typeof userSettings.mode === 'string'
        ? userSettings.mode.trim()
        : undefined;
      const rawCustomInstructions = userSettings?.customInstructions ?? [];
      const customInstructions = Array.isArray(rawCustomInstructions)
        ? rawCustomInstructions
            .filter((instruction) => typeof instruction === 'string')
            .map((instruction) => (instruction as string).trim())
            .filter((instruction) => instruction.length > 0)
        : [];

      const languageDirective = language === 'auto'
        ? 'Write the reply in the same language as the original email unless the user preference clearly indicates otherwise.'
        : `Write the reply in ${language}.`;

      const toneDirective = tone === 'auto'
        ? 'Match the tone of the original email while remaining professional.'
        : `Use a ${tone} tone while remaining professional.`;

      const lengthDirective = length === 'auto'
        ? 'Keep the reply brief (1-3 sentences) unless additional detail is needed for clarity.'
        : `Keep the reply ${length}.`;

      const modeDirective = mode
        ? `Respect the user\'s preferred mode: "${mode}".`
        : '';

      const additionalDirectives = customInstructions.length > 0
        ? `Follow these additional user instructions:\n- ${customInstructions.map((instruction) => instruction.trim()).join('\n- ')}`
        : '';

      const systemPrompt = `You are an AI email assistant that generates quick, contextual email replies.
      
Requirements:
- ${languageDirective}
- ${toneDirective}
- ${lengthDirective}
- Always address the quick reply type intent: "${quickReplyType}".
- Include proper greetings and closings appropriate for the context with clear formatting (e.g., greeting on its own line).
- Make the reply sound natural and personalized, never robotic.
${modeDirective ? `- ${modeDirective}` : ''}
${additionalDirectives ? `${additionalDirectives}\n` : ''}
Return ONLY the reply text without any JSON formatting, quotes, or metadata.`;

    const userPrompt = `Quick Reply Type: "${quickReplyType}"

Original Email Content:
${formattedContent}

Generate a brief, professional reply based on the quick reply type above. The reply should be contextual to the email content and follow all user preferences provided.`;
      logger.debug('Generating quick reply with prompts', {
        quickReplyType,
        systemPrompt,
        userPrompt
      });
      const response = await this.openai.chat.completions.create({
        model: openAIModel,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ]
      });

      const reply = response.choices[0].message.content?.trim() || quickReplyType;
      logger.info('Quick reply generated successfully', { 
        quickReplyType, 
        replyLength: reply.length 
      });
      
      return reply;
    } catch (error) {
      logger.error('Quick reply generation error', { 
        quickReplyType,
        error: (error as Error).message 
      });
      // Return the basic quick reply type as fallback
      return quickReplyType;
    }
  }
}

export default new AIService();
