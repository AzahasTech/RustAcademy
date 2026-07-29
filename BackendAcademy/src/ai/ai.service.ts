import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateChatRequestDto } from './dto/create-chat-request.dto';
import { GetHintDto } from './dto/get-hint.dto';
import { PreScoreDto } from './dto/pre-score.dto';
import { VoiceInteractionDto } from './dto/voice-interaction.dto';
import { TtsRequestDto } from './dto/tts-request.dto';
import {
  AiChatResponse,
  AiChatRecord,
  AiHintResponse,
  AiRecommendationResponse,
  ChatMessage,
  Hint,
  VoiceInteractionResponse,
  TtsResponse,
} from './interfaces/ai.interface';
import { PreScoreResult } from './interfaces/pre-score.interface';
import { AiProvider } from './interfaces/ai-provider.interface';
import { PromptTemplateService } from './prompt-template.service';
import { v4 as uuidv4 } from 'uuid';
import { AnalyticsService } from '../analytics/analytics.service';
import { RedisService } from '../redis/redis.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { SecurityService } from '../security/security.service';

export const AI_PROVIDER = 'AI_PROVIDER';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private chatHistory: Map<string, ChatMessage[]> = new Map();
  private chatRecords: Map<string, AiChatRecord> = new Map();
  private hints: Map<string, Hint[]> = new Map();
  private readonly defaultTimeoutMs: number;
  private readonly maxChatHistoryLength: number;

  constructor(
    @Optional() @Inject(AI_PROVIDER) private aiProvider?: AiProvider,
    private configService?: ConfigService,
    private readonly analyticsService?: AnalyticsService,
    private readonly redisService?: RedisService,
    private readonly monitoringService?: MonitoringService,
    @Optional() private readonly promptTemplateService?: PromptTemplateService,
    @Optional() private readonly securityService?: SecurityService,
  ) {
    this.defaultTimeoutMs = this.configService?.get<number>('DEFAULT_REQUEST_TIMEOUT_MS') ?? 30_000;
    this.maxChatHistoryLength = this.configService?.get<number>('AI_MAX_CHAT_HISTORY_LENGTH') ?? 50;
    this.initializeSampleHints();
  }

  async getRecommendation(userId: string): Promise<AiRecommendationResponse> {
    const snapshot = this.redisService
      ? await this.redisService.getUserSnapshot(userId)
      : null;

    if (!snapshot) {
      return {
        userId,
        recommendations: [],
        explainability: {
          factors: ['insufficient_data'],
          confidence: 0.1,
          userSignalAge: 0,
          signalsUsed: [],
          modelVersion: 'rustacademy-recommender-v2',
        },
        generatedAt: new Date(),
      };
    }

    const explainability = this.redisService
      ? await this.redisService.getRecommendationExplainability(userId)
      : null;

    const recommendedCourses = snapshot.recentCourses.length > 0
      ? snapshot.recentCourses.slice(0, 3)
      : ['rust-fundamentals', 'smart-contracts-101', 'stellar-basics'];

    const recommendations = recommendedCourses.map((courseId, index) => ({
      courseId,
      score: Math.max(0, 1 - index * 0.2 - (snapshot.interactionCount > 0 ? 0 : 0.3)),
      reason: explainability?.factors[index] || 'course_popularity',
    }));

    if (this.monitoringService) {
      this.monitoringService.recordDomainEvent('recommendation_generated', 'ai');
    }

    return {
      userId,
      recommendations,
      explainability: explainability || {
        factors: [],
        confidence: 0.1,
        userSignalAge: 0,
        signalsUsed: [],
        modelVersion: 'rustacademy-recommender-v2',
      },
      generatedAt: new Date(),
    };
  }

  async processChatRequest(
    createChatRequestDto: CreateChatRequestDto,
  ): Promise<AiChatResponse> {
    const { message, userId, context } = createChatRequestDto;

    // #374: Use versioned prompt template from configuration
    const systemPrompt = this.promptTemplateService
      ? this.promptTemplateService.getSystemPrompt('chat_tutor', {
          version: this.configService?.get<string>('AI_PROMPT_TEMPLATE_VERSION'),
        })
      : 'You are a helpful Rust programming tutor.';

    const response = this.aiProvider
      ? await this.aiProvider.generateChatCompletion({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
        })
      : this.fallbackResponse(message);
    // Issue #371: sanitise user-supplied prompts before they reach the AI
    // provider. When SecurityService is wired in, prompts containing known
    // prompt-injection patterns are either wrapped in a hard system-pinned
    // boundary or rejected outright. Without SecurityService we degrade
    // gracefully (the previous behaviour) so unit tests keep working.
    const sanitisation = this.securityService
      ? this.securityService.sanitisePrompt(message)
      : null;

    const effectiveMessage = sanitisation?.sanitised ?? message;

    const response = sanitisation?.status === 'rejected'
      ? sanitisation.sanitised
      : this.aiProvider
        ? await this.aiProvider.generateChatCompletion({
            messages: [
              { role: 'system', content: 'You are a helpful Rust programming tutor.' },
              { role: 'user', content: effectiveMessage },
            ],
          })
        : this.fallbackResponse(effectiveMessage);

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId,
      message,
      response,
      timestamp: new Date(),
      context,
      isComplete: true,
    };

    if (!this.chatHistory.has(userId)) {
      this.chatHistory.set(userId, []);
    }
    this.chatHistory.get(userId)!.push(chatMessage);

    // #372: Auto-summarise when history exceeds threshold
    await this.autoSummarize(userId);

    // Track prompt template version in metrics (#374)
    if (this.monitoringService) {
      const templateVersion =
        this.configService?.get<string>('AI_PROMPT_TEMPLATE_VERSION') ?? '1.0.0';
      this.monitoringService.incrementCounter('ai_prompt_template_used', 1, {
        version: templateVersion,
        template: 'chat_tutor',
      });
    }

    if (this.redisService) {
      await this.redisService.refreshUserSnapshot(userId, {
        lastInteractionAt: new Date(),
        interactionCount: 1,
        eventTypes: ['chat_message'],
      });
    }

    return {
      response: chatMessage.response,
      timestamp: chatMessage.timestamp,
      messageId: chatMessage.id,
      // Surface the sanitisation outcome so callers can audit unsafe inputs.
      ...(sanitisation && sanitisation.status !== 'safe'
        ? {
            safety: {
              status: sanitisation.status,
              reasons: sanitisation.reasons,
              originalLength: sanitisation.originalLength,
            },
          }
        : {}),
    };
  }

  async getHint(getHintDto: GetHintDto): Promise<AiHintResponse> {
    const { challengeId, difficulty = 1 } = getHintDto;

    const challengeHints = this.hints.get(challengeId) || [];

    const hint =
      challengeHints.find((h) => h.difficulty === difficulty) ||
      challengeHints[0];

    if (!hint) {
      return {
        hint: 'No hints available for this challenge yet. Keep trying!',
        hintId: uuidv4(),
        difficulty: 1,
      };
    }

    hint.usedCount++;

    return {
      hint: hint.hint,
      hintId: hint.id,
      difficulty: hint.difficulty,
    };
  }

  async preScore(dto: PreScoreDto): Promise<PreScoreResult> {
    const { taskId, code } = dto;
    const lines = code.split('\n').filter((l) => l.trim().length > 0).length;
    const hasComments = code.includes('//') || code.includes('/*');
    const hasFunctions = code.includes('fn ');
    const hasMain = code.includes('fn main');

    let score = 50;
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const suggestions: string[] = [];

    if (hasMain) {
      score += 15;
      strengths.push('Includes a main function entry point');
    } else {
      weaknesses.push('No main function found');
      suggestions.push('Add a fn main() entry point to your program');
    }

    if (hasFunctions && lines > 5) {
      score += 15;
      strengths.push('Code is organized into functions');
    } else if (lines <= 5) {
      weaknesses.push('Very short submission - may be incomplete');
      suggestions.push('Expand your solution with proper implementation');
    }

    if (hasComments) {
      score += 10;
      strengths.push('Code includes helpful comments');
    } else {
      suggestions.push('Consider adding comments to explain your logic');
    }

    if (lines > 20) {
      score += 10;
      strengths.push('Comprehensive implementation');
    }

    score = Math.min(100, Math.max(0, score));

    if (this.analyticsService) {
      await this.analyticsService.trackEvent({
        id: uuidv4(),
        eventType: 'submission_prescore',
        properties: { taskId, score, lines },
      });
    }

    return {
      taskId,
      predictedScore: score,
      confidence: 0.7,
      feedback:
        score >= 70
          ? 'Your submission looks promising. Keep refining!'
          : 'Your submission needs improvement. Review the suggestions below.',
      strengths,
      weaknesses,
      suggestions,
      evaluatedAt: new Date(),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Chat history management (#372, #373)
  // ──────────────────────────────────────────────────────────────────

  async getChatHistory(userId: string): Promise<ChatMessage[]> {
    return this.chatHistory.get(userId) || [];
  }

  /**
   * #373: Marks a message as incomplete when a chat streaming disconnect
   * leaves a partial response in state. Incomplete messages can be cleaned
   * up or shown to the user with a warning.
   */
  markMessageIncomplete(userId: string, messageId: string): boolean {
    const history = this.chatHistory.get(userId);
    if (!history) return false;

    const msg = history.find((m) => m.id === messageId);
    if (!msg) return false;

    msg.isComplete = false;

    if (this.monitoringService) {
      this.monitoringService.incrementCounter('chat_streaming_disconnects', 1, {
        userId,
        messageId,
      });
    }

    this.logger.warn(
      `Message ${messageId} for user ${userId} marked incomplete due to streaming disconnect`,
    );
    return true;
  }

  /**
   * #373: Removes all incomplete messages from a user's chat history,
   * preventing partial responses from persisting in conversation state.
   */
  cleanupIncompleteMessages(userId: string): number {
    const history = this.chatHistory.get(userId);
    if (!history) return 0;

    const incompleteCount = history.filter((m) => !m.isComplete).length;
    const cleaned = history.filter((m) => m.isComplete);
    this.chatHistory.set(userId, cleaned);

    if (incompleteCount > 0) {
      this.logger.log(
        `Cleaned up ${incompleteCount} incomplete messages for user ${userId}`,
      );
      if (this.monitoringService) {
        this.monitoringService.incrementCounter(
          'chat_incomplete_messages_cleaned',
          incompleteCount,
          { userId },
        );
      }
    }
    return incompleteCount;
  }

  /**
   * #372: Automatically generates a conversation summary when chat history
   * exceeds the configured maxChatHistoryLength. Older messages are compacted
   * into a summary string to keep token usage under control during long
   * tutoring sessions.
   */
  private async autoSummarize(userId: string): Promise<void> {
    const history = this.chatHistory.get(userId);
    if (!history || history.length <= this.maxChatHistoryLength) return;

    const excess = history.length - this.maxChatHistoryLength;
    const olderMessages = history.slice(0, excess);
    const recentMessages = history.slice(excess);

    // Build a compact summary from older messages
    const topicSummary = this.buildConversationSummary(olderMessages);

    // Store the summary on the most relevant chat record or create one
    const existingRecord = Array.from(this.chatRecords.values()).find(
      (r) => r.userId === userId,
    );

    const summaryText = `[Conversation summary — ${new Date().toISOString()}]: ${topicSummary}`;

    if (existingRecord) {
      existingRecord.summary = existingRecord.summary
        ? `${existingRecord.summary}\n${summaryText}`
        : summaryText;
      existingRecord.lastSummaryAt = new Date();
    } else {
      const newRecord: AiChatRecord = {
        id: uuidv4(),
        userId,
        sessionId: `session-${Date.now()}`,
        messages: recentMessages,
        startedAt: olderMessages[0]?.timestamp ?? new Date(),
        lastActivityAt: new Date(),
        summary: summaryText,
        lastSummaryAt: new Date(),
      };
      this.chatRecords.set(newRecord.id, newRecord);
    }

    // Keep only the most recent messages in active history
    this.chatHistory.set(userId, recentMessages);

    if (this.monitoringService) {
      this.monitoringService.incrementCounter('chat_summary_generated', 1, {
        userId,
        compactedCount: String(excess),
      });
    }

    this.logger.log(
      `Auto-summarised ${excess} messages for user ${userId} (${recentMessages.length} retained)`,
    );
  }

  /**
   * #372: Builds a compact conversation summary from a list of chat messages.
   * Extracts key topics and user questions without storing the full text.
   */
  private buildConversationSummary(messages: ChatMessage[]): string {
    if (messages.length === 0) return 'No prior conversation.';

    const userMessages = messages
      .filter((m) => m.message && m.message.trim().length > 0)
      .map((m) => m.message.slice(0, 120));

    if (userMessages.length === 0) return `${messages.length} interactions.`;

    const topics = userMessages.slice(0, 10).join('; ');
    const topicPreview =
      topics.length > 500 ? topics.slice(0, 500) + '...' : topics;

    return `${messages.length} messages covering: ${topicPreview}`;
  }

  /**
   * #372: Returns the current conversation summary for a user, if one exists.
   */
  getConversationSummary(userId: string): string | null {
    const record = Array.from(this.chatRecords.values()).find(
      (r) => r.userId === userId,
    );
    return record?.summary ?? null;
  }

  getChatRecord(sessionId: string): AiChatRecord | null {
    return this.chatRecords.get(sessionId) ?? null;
  }

  listChatRecords(userId: string): AiChatRecord[] {
    return Array.from(this.chatRecords.values()).filter((r) => r.userId === userId);
  }

  async processVoice(dto: VoiceInteractionDto) {
    const transcription = `[Transcribed: ${dto.audioData.slice(0, 50)}...]`;
    const response: VoiceInteractionResponse = {
      transcription,
      confidence: 0.85,
      processedAt: new Date(),
    };
    return response;
  }

  async generateTts(dto: TtsRequestDto) {
    const response: TtsResponse = {
      audioData: Buffer.from(dto.text).toString('base64'),
      format: 'audio/wav',
      durationMs: dto.text.length * 60,
    };
    return response;
  }

  private fallbackResponse(userMessage: string): string {
    const responses = [
      "That's a great question! Let me help you work through that. Based on what you've shared, I think the first thing you should understand is the core concept behind the problem.",
      "Good thinking! You're on the right track. To move forward, I'd recommend reviewing the documentation on this topic and trying to implement a small piece first.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  private initializeSampleHints() {
    const sampleHints: Hint[] = [
      {
        id: uuidv4(),
        challengeId: 'sample-challenge-001',
        hint: 'Start by understanding the problem requirements thoroughly.',
        difficulty: 1,
        usedCount: 0,
      },
      {
        id: uuidv4(),
        challengeId: 'sample-challenge-001',
        hint: 'Consider edge cases - empty, null, or out-of-range inputs.',
        difficulty: 2,
        usedCount: 0,
      },
      {
        id: uuidv4(),
        challengeId: 'sample-challenge-001',
        hint: 'Implement brute-force first, then optimize.',
        difficulty: 3,
        usedCount: 0,
      },
    ];

    this.hints.set('sample-challenge-001', sampleHints);
  }

  /**
   * Executes an outbound AI provider call with a global request timeout — Issue #408.
   */
  async fetchWithTimeout(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
