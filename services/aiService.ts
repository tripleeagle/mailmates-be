import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../config/logger';
import { AISettings, AIResponse } from '../types';

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

  async generateEmail(prompt: string, settings: AISettings, emailContext?: string | null): Promise<AIResponse> {
    const model = settings.aiModel || 'default';
    
    try {
      let result: AIProviderResponse;
      
      switch (model) {
        case 'gpt-4o':
        case 'default':
          result = await this.generateWithOpenAI(prompt, settings, emailContext);
          break;
        case 'claude-3':
          result = await this.generateWithClaude(prompt, settings, emailContext);
          break;
        case 'gemini-2.5':
          result = await this.generateWithGemini(prompt, settings, emailContext);
          break;
        case 'llama-3.1':
          result = await this.generateWithLlama(prompt, settings, emailContext);
          break;
        case 'deepseek-v3.1':
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

  private async generateWithOpenAI(prompt: string, settings: AISettings, emailContext?: string | null): Promise<AIProviderResponse> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }
    
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(settings, emailContext);
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      temperature: 0.7,
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

  private async generateWithClaude(prompt: string, settings: AISettings, emailContext?: string | null): Promise<AIProviderResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }
    
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(settings, emailContext);
    
    const response = await this.anthropic.completions.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens_to_sample: 1000,
      prompt: `${systemPrompt}\n\nHuman: ${prompt}\n\nAssistant:`
    });

    const processingTime = Date.now() - startTime;
    const content = response.completion;
    const parsedContent = JSON.parse(content);

    return {
      subject: parsedContent.subject,
      body: parsedContent.body,
      tokensUsed: {
        input: 0, // Anthropic completions API doesn't provide token usage
        output: 0,
        total: 0
      },
      processingTime
    };
  }

  private async generateWithGemini(prompt: string, settings: AISettings, emailContext?: string | null): Promise<AIProviderResponse> {
    if (!this.googleAI) {
      throw new Error('Google AI API key not configured');
    }
    
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(settings, emailContext);
    const model = this.googleAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    
    const fullPrompt = `${systemPrompt}\n\nUser Request: ${prompt}`;
    
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const content = response.text();
    const parsedContent = JSON.parse(content);

    const processingTime = Date.now() - startTime;

    return {
      subject: parsedContent.subject,
      body: parsedContent.body,
      tokensUsed: { input: 0, output: 0, total: 0 }, // Gemini doesn't provide token count in free tier
      processingTime
    };
  }

  private async generateWithLlama(prompt: string, settings: AISettings, emailContext?: string | null): Promise<AIProviderResponse> {
    // This would integrate with a Llama API service
    // For now, we'll use a fallback to OpenAI
    logger.warn('Llama 3.1 not yet implemented, falling back to OpenAI');
    return this.generateWithOpenAI(prompt, settings, emailContext);
  }

  private async generateWithDeepSeek(prompt: string, settings: AISettings, emailContext?: string | null): Promise<AIProviderResponse> {
    // This would integrate with DeepSeek API
    // For now, we'll use a fallback to OpenAI
    logger.warn('DeepSeek-V3.1 not yet implemented, falling back to OpenAI');
    return this.generateWithOpenAI(prompt, settings, emailContext);
  }

  private buildSystemPrompt(settings: AISettings, emailContext?: string | null): string {
    const { language, tone, length, customInstructions } = settings;
    
    let systemPrompt = `You are an AI email assistant. Generate professional emails based on user requests.

Requirements:
- Always respond with valid JSON in this exact format: {"subject": "Email Subject", "body": "Email Body"}
- Write in ${language === 'auto' ? 'the most appropriate language' : language}
- Use a ${tone === 'auto' ? 'professional' : tone} tone
- Make it ${length === 'auto' ? 'appropriately' : length} length
- Be professional, clear, and concise
- Include proper email formatting with greetings and closings`;

    if (emailContext) {
      systemPrompt += `\n\nContext from the email being replied to:\n${emailContext}`;
    }

    if (customInstructions && customInstructions.length > 0) {
      systemPrompt += `\n\nCustom Instructions:\n${customInstructions.join('\n')}`;
    }

    systemPrompt += `\n\nGenerate the email now:`;

    return systemPrompt;
  }

  async summarizeEmail(emailContent: string): Promise<string> {
    if (!this.openai) {
      throw new Error('Email summarization not available - OpenAI API key not configured.');
    }
    
    logger.info('Summarizing email', { contentLength: emailContent.length });

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [
          {
            role: 'system',
            content: 'You are an email summarizer. Your task is to read the content of an email and generate a clear, concise summary of 1–3 sentences. Focus only on the main points, such as purpose, requests, key updates, or next steps. Exclude greetings, signatures, and unnecessary details. The summary should be neutral, factual, and easy to scan quickly.'
          },
          {
            role: 'user',
            content: emailContent
          }
        ]
      });

      return response.choices[0].message.content?.trim() || 'Could not generate summary.';
    } catch (error) {
      logger.error('Email summarization error', { error: (error as Error).message });
      return 'Email content could not be summarized.';
    }
  }
}

export default new AIService();
