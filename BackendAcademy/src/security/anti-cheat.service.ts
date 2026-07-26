import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AntiCheatResult } from './interfaces/anti-cheat.interface';
import { CheckSubmissionDto } from './dto/check-submission.dto';
import { randomUUID, createHash } from 'crypto';

/**
 * AntiCheatService
 *
 * Placeholder service for AI-based anti-cheat analysis.
 *
 * TODO: Replace the stub implementation with a real AI provider,
 *       e.g. an internal ML model, OpenAI, or a dedicated cheat-detection API.
 *       The `AntiCheatProvider` interface in interfaces/anti-cheat.interface.ts
 *       defines the contract to implement.
 */
export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyHash: string;
  label: string;
  createdAt: Date;
  expiresAt: Date | null;
  revoked: boolean;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
}

export interface ApiKeyUsageEvent {
  apiKeyId: string;
  userId: string;
  endpoint: string;
  timestamp: Date;
  ip: string;
  userAgent: string;
}

@Injectable()
export class AntiCheatService {
  private readonly logger = new Logger(AntiCheatService.name);
  private readonly apiKeys = new Map<string, ApiKeyRecord>();
  private readonly apiKeyUsageLog: ApiKeyUsageEvent[] = [];
  private readonly usageRateLimit = 100; // max requests per minute per key
  private readonly usageWindowMs = 60_000;

  /**
   * Analyse a single submission for signs of cheating.
   *
   * Current behaviour: always returns a "low risk / not flagged" result
   * so that the rest of the platform can integrate against this API
   * before the real model is wired up.
   */
  async analyzeSubmission(dto: CheckSubmissionDto): Promise<AntiCheatResult> {
    this.logger.log(
      `[PLACEHOLDER] Analysing submission for learnerId=${dto.learnerId}, taskId=${dto.taskId}`,
    );

    // ─── TODO: call your AI / ML provider here ───────────────────────────────
    // Example integration point:
    //
    //   const response = await this.aiProvider.analyzeSubmission(
    //     dto.learnerId,
    //     dto.taskId,
    //     dto.content,
    //     dto.metadata,
    //   );
    //   return response;
    // ─────────────────────────────────────────────────────────────────────────

    // Stub: safe default while the real model is not yet connected
    return {
      flagged: false,
      confidence: 0,
      riskLevel: 'low',
      reason: 'AI anti-cheat check not yet implemented — placeholder result returned.',
      recommendedAction: 'none',
    };
  }

  /**
   * Batch-analyse multiple submissions in one call.
   * Useful for background audit jobs or bulk re-scoring.
   */
  async analyzeSubmissions(dtos: CheckSubmissionDto[]): Promise<AntiCheatResult[]> {
    this.logger.log(`[PLACEHOLDER] Batch analysing ${dtos.length} submission(s)`);

    return Promise.all(dtos.map((dto) => this.analyzeSubmission(dto)));
  }

  // ---------------------------------------------------------------------------
  // API Key Management
  // ---------------------------------------------------------------------------

  createApiKey(userId: string, label: string, expiresInDays?: number): { id: string; rawKey: string } {
    const id = randomUUID();
    const rawKey = `ak_${randomUUID().replace(/-/g, '')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const record: ApiKeyRecord = {
      id,
      userId,
      keyHash,
      label,
      createdAt: new Date(),
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
      revoked: false,
      revokedAt: null,
      lastUsedAt: null,
      usageCount: 0,
    };

    this.apiKeys.set(id, record);
    this.logger.log(`API key created for user ${userId}: ${id}`);
    return { id, rawKey };
  }

  validateApiKey(rawKey: string): ApiKeyRecord {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    for (const record of this.apiKeys.values()) {
      if (record.keyHash === keyHash) {
        if (record.revoked) {
          throw new UnauthorizedException('API key has been revoked');
        }
        if (record.expiresAt && new Date() > record.expiresAt) {
          throw new UnauthorizedException('API key has expired');
        }
        record.lastUsedAt = new Date();
        record.usageCount++;
        return record;
      }
    }

    throw new UnauthorizedException('Invalid API key');
  }

  revokeApiKey(keyId: string): void {
    const record = this.apiKeys.get(keyId);
    if (record) {
      record.revoked = true;
      record.revokedAt = new Date();
      this.logger.warn(`API key ${keyId} revoked for user ${record.userId}`);
    }
  }

  revokeAllUserApiKeys(userId: string): number {
    let count = 0;
    for (const record of this.apiKeys.values()) {
      if (record.userId === userId && !record.revoked) {
        record.revoked = true;
        record.revokedAt = new Date();
        count++;
      }
    }
    this.logger.warn(`Revoked ${count} API keys for user ${userId}`);
    return count;
  }

  getUserApiKeys(userId: string): ApiKeyRecord[] {
    return Array.from(this.apiKeys.values()).filter((r) => r.userId === userId);
  }

  // ---------------------------------------------------------------------------
  // API Key Usage Tracking & Anomaly Detection
  // ---------------------------------------------------------------------------

  trackApiKeyUsage(apiKeyId: string, userId: string, endpoint: string, ip: string, userAgent: string): void {
    this.apiKeyUsageLog.push({
      apiKeyId,
      userId,
      endpoint,
      timestamp: new Date(),
      ip,
      userAgent,
    });
  }

  getApiKeyUsage(apiKeyId: string, since?: Date): ApiKeyUsageEvent[] {
    const events = this.apiKeyUsageLog.filter((e) => e.apiKeyId === apiKeyId);
    if (since) {
      return events.filter((e) => e.timestamp >= since);
    }
    return events;
  }

  async detectAnomalies(apiKeyId: string): Promise<{ anomalous: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const now = Date.now();
    const recent = this.apiKeyUsageLog.filter(
      (e) => e.apiKeyId === apiKeyId && now - e.timestamp.getTime() < this.usageWindowMs,
    );

    if (recent.length > this.usageRateLimit) {
      reasons.push(`Rate limit exceeded: ${recent.length} requests in last minute`);
    }

    const uniqueIps = new Set(recent.map((e) => e.ip));
    if (uniqueIps.size > 5) {
      reasons.push(`Abnormal IP diversity: ${uniqueIps.size} unique IPs in last minute`);
    }

    const uniqueAgents = new Set(recent.map((e) => e.userAgent));
    if (uniqueAgents.size > 3) {
      reasons.push(`Abnormal user-agent diversity: ${uniqueAgents.size} unique agents`);
    }

    return { anomalous: reasons.length > 0, reasons };
  }

  // ---------------------------------------------------------------------------
  // Key Rotation on Privilege Change
  // ---------------------------------------------------------------------------

  async rotateKeysOnPrivilegeChange(userId: string): Promise<number> {
    const count = this.revokeAllUserApiKeys(userId);
    this.logger.warn(`Rotated ${count} API keys for user ${userId} due to privilege change`);
    return count;
  }
}
