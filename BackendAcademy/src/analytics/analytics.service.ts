import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsEvent } from './analytics.entity';
import { RedisService } from '../redis/redis.service';
import { v4 as uuidv4 } from 'uuid';
import { StateReconciliationResult } from '../contracts/interfaces/contracts.interface';

export enum EventType {
  USER_REGISTERED = 'user_registered',
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  PROFILE_UPDATED = 'profile_updated',
  COURSE_ENROLLED = 'course_enrolled',
  COURSE_COMPLETED = 'course_completed',
  CHALLENGE_STARTED = 'challenge_started',
  CHALLENGE_COMPLETED = 'challenge_completed',
  CHALLENGE_SUBMITTED = 'challenge_submitted',
  BADGE_EARNED = 'badge_earned',
  TUTORIAL_STARTED = 'tutorial_started',
  TUTORIAL_COMPLETED = 'tutorial_completed',
  REWARD_CLAIMED = 'reward_claimed',
  LEADERBOARD_VIEWED = 'leaderboard_viewed',
  API_KEY_CREATED = 'api_key_created',
  API_KEY_REVOKED = 'api_key_revoked',
  API_KEY_USED = 'api_key_used',
  API_KEY_ANOMALY = 'api_key_anomaly',
  SESSION_REVOKED = 'session_revoked',
  DEVICE_BOUND = 'device_bound',
  PRIVILEGE_CHANGED = 'privilege_changed',
  // #394: Reconciliation events
  CONTRACT_RECONCILIATION_STARTED = 'contract_reconciliation_started',
  CONTRACT_RECONCILIATION_COMPLETED = 'contract_reconciliation_completed',
  CONTRACT_REPLAY_STARTED = 'contract_replay_started',
  CONTRACT_REPLAY_COMPLETED = 'contract_replay_completed',
}

/**
 * Summary of reconciliation activity for analytics.
 */
export interface ReconciliationSummary {
  totalReconciliations: number;
  consistentStateCount: number;
  inconsistentStateCount: number;
  lastReconciliationAt: Date | null;
  totalDiscrepanciesFound: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly events: AnalyticsEvent[] = [];

  /** #394: History of reconciliation results for analytics */
  private readonly reconciliationHistory: StateReconciliationResult[] = [];

  constructor(private readonly redisService?: RedisService) {}

  async trackEvent(event: Partial<AnalyticsEvent>): Promise<AnalyticsEvent> {
    const analyticsEvent = new AnalyticsEvent({
      ...event,
      id: event.id || uuidv4(),
      timestamp: event.timestamp || new Date(),
    });
    this.events.push(analyticsEvent);

    if (this.redisService && analyticsEvent.userId) {
      const eventTypes = [analyticsEvent.eventType];
      const interactionData: Record<string, any> = {
        lastInteractionAt: new Date(),
        interactionCount: 1,
        eventTypes,
      };

      if (analyticsEvent.eventType === EventType.COURSE_ENROLLED) {
        interactionData.recentCourses = analyticsEvent.properties?.courseId
          ? [analyticsEvent.properties.courseId]
          : [];
      }
      if (analyticsEvent.eventType === EventType.CHALLENGE_COMPLETED) {
        interactionData.recentChallenges = analyticsEvent.properties?.challengeId
          ? [analyticsEvent.properties.challengeId]
          : [];
      }
      // #394: Track reconciliation interactions
      if (
        analyticsEvent.eventType === EventType.CONTRACT_RECONCILIATION_COMPLETED
      ) {
        interactionData.lastReconciliationAt = new Date();
      }

      await this.redisService.refreshUserSnapshot(analyticsEvent.userId, interactionData);
    }

    return analyticsEvent;
  }

  async getEventsByUserId(userId: string): Promise<AnalyticsEvent[]> {
    return this.events.filter((event) => event.userId === userId);
  }

  async getEventsByType(eventType: string): Promise<AnalyticsEvent[]> {
    return this.events.filter((event) => event.eventType === eventType);
  }

  async getEventsByDateRange(startDate: Date, endDate: Date): Promise<AnalyticsEvent[]> {
    return this.events.filter(
      (event) => event.timestamp >= startDate && event.timestamp <= endDate,
    );
  }

  async getEventStatistics(): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    uniqueUsers: number;
  }> {
    const eventsByType: Record<string, number> = {};
    const uniqueUsers = new Set<string>();

    for (const event of this.events) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      if (event.userId) {
        uniqueUsers.add(event.userId);
      }
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      uniqueUsers: uniqueUsers.size,
    };
  }

  async getAllEvents(limit?: number): Promise<AnalyticsEvent[]> {
    if (limit) {
      return this.events.slice(-limit);
    }
    return this.events;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const index = this.events.findIndex((event) => event.id === id);
    if (index === -1) return false;
    this.events.splice(index, 1);
    return true;
  }

  async clearOldEvents(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const initialLength = this.events.length;
    const filtered = this.events.filter((event) => event.timestamp >= cutoffDate);
    this.events.length = 0;
    this.events.push(...filtered);

    return initialLength - this.events.length;
  }

  // ──────────────────────────────────────────────────────────────────
  // #394: Contract reconciliation tracking
  // ──────────────────────────────────────────────────────────────────

  /**
   * Records a state reconciliation result for analytics tracking.
   */
  recordReconciliation(result: StateReconciliationResult): void {
    this.reconciliationHistory.push(result);
    this.logger.log(
      `Reconciliation recorded for ${result.contractId}: consistent=${result.isConsistent}, discrepancies=${result.discrepancies.length}`,
    );

    // Limit history size
    if (this.reconciliationHistory.length > 1000) {
      this.reconciliationHistory.splice(0, this.reconciliationHistory.length - 1000);
    }
  }

  /**
   * Returns reconciliation history, optionally filtered by contract.
   */
  getReconciliationHistory(contractId?: string): StateReconciliationResult[] {
    const history = [...this.reconciliationHistory];
    history.sort(
      (a, b) => b.reconciledAt.getTime() - a.reconciledAt.getTime(),
    );
    return contractId
      ? history.filter((r) => r.contractId === contractId)
      : history;
  }

  /**
   * Returns a summary of all reconciliation activity.
   */
  getReconciliationSummary(): ReconciliationSummary {
    let consistent = 0;
    let inconsistent = 0;
    let totalDiscrepancies = 0;
    let lastAt: Date | null = null;

    for (const result of this.reconciliationHistory) {
      if (result.isConsistent) {
        consistent++;
      } else {
        inconsistent++;
      }
      totalDiscrepancies += result.discrepancies.length;

      if (!lastAt || result.reconciledAt > lastAt) {
        lastAt = result.reconciledAt;
      }
    }

    return {
      totalReconciliations: this.reconciliationHistory.length,
      consistentStateCount: consistent,
      inconsistentStateCount: inconsistent,
      lastReconciliationAt: lastAt,
      totalDiscrepanciesFound: totalDiscrepancies,
    };
  }
}
