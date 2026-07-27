import { Injectable } from '@nestjs/common';
import { AnalyticsEvent } from './analytics.entity';
import { RedisService } from '../redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

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
}

@Injectable()
export class AnalyticsService {
  private readonly events: AnalyticsEvent[] = [];

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

      await this.redisService.refreshUserSnapshot(analyticsEvent.userId, interactionData);
    }

    return analyticsEvent;
  }

  async getEventsByUserId(userId: string): Promise<AnalyticsEvent[]> {
    return this.events.filter(event => event.userId === userId);
  }

  async getEventsByType(eventType: string): Promise<AnalyticsEvent[]> {
    return this.events.filter(event => event.eventType === eventType);
  }

  async getEventsByDateRange(startDate: Date, endDate: Date): Promise<AnalyticsEvent[]> {
    return this.events.filter(
      event => event.timestamp >= startDate && event.timestamp <= endDate,
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

  /**
   * Returns events using cursor-based pagination with stable ordering.
   */
  async getEventsPaginated(options: {
    cursor?: string;
    limit: number;
    userId?: string;
  }): Promise<{ events: AnalyticsEvent[]; nextCursor?: string }> {
    let filtered = [...this.events];
    if (options.userId) {
      filtered = filtered.filter((e) => e.userId === options.userId);
    }

    const sorted = filtered.sort((a, b) => {
      const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.id ?? '').localeCompare(a.id ?? '');
    });

    let startIndex = 0;
    if (options.cursor) {
      const cursorIdx = sorted.findIndex((e) => e.id === options.cursor);
      if (cursorIdx !== -1) startIndex = cursorIdx + 1;
    }

    const events = sorted.slice(startIndex, startIndex + options.limit);
    const nextCursor =
      events.length === options.limit
        ? events[events.length - 1].id
        : undefined;

    return { events, nextCursor };
  }

  async deleteEvent(id: string): Promise<boolean> {
    const index = this.events.findIndex(event => event.id === id);
    if (index === -1) return false;
    this.events.splice(index, 1);
    return true;
  }

  async clearOldEvents(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const initialLength = this.events.length;
    const filtered = this.events.filter(event => event.timestamp >= cutoffDate);
    this.events.length = 0;
    this.events.push(...filtered);

    return initialLength - this.events.length;
  }
}
