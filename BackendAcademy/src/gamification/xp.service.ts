import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';

import { DomainEventBus } from './domain-event-bus';
import { XpEvent, XpEventType, XpLedgerEntry } from './xp.types';

const XP_BY_EVENT: Record<XpEventType, number> = {
  'task.passed': 10,
  'course.completed': 100,
  'streak.day': 5,
  'contribution.created': 25,
};

@Injectable()
export class XpService implements OnModuleInit, OnModuleDestroy {
  private readonly ledger = new Map<string, XpLedgerEntry>();
  private subscription?: Subscription;
  private currentLearnerId?: string;

  constructor(private readonly eventBus: DomainEventBus) {}

  onModuleInit(): void {
    this.subscription = this.eventBus.subscribe((event) => this.award(event));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Determines whether the current caller is allowed to publish an XP event
   * for the given learner. XP publication is learner-scoped: an event may only be
   * published for the learner identified by the request context.
   */
  canPublishFor(userId: string): boolean {
    if (!userId || typeof userId !== 'string') {
      return false;
    }

    const actorUserId = this.getActorUserId();
    return actorUserId === userId;
  }

  /**
   * Resolves the learner identity for the current publish request. The learner
   * identity is the only source of truth for whom an award may be issued to.
   */
  private getActorUserId(): string | undefined {
    return this.currentLearnerId;
  }

  /**
   * Sets the learner identity for the duration of a request. This is the authoritative
   * source for who may receive an XP award.
   */
  withLearnerContext<T>(
    userId: string,
    fn: () => T,
  ): T {
    const previous = this.currentLearnerId;
    this.currentLearnerId = userId;
    try {
      return fn();
    } finally {
      this.currentLearnerId = previous;
    }
  }

  award(event: XpEvent): XpLedgerEntry | null {
    if (this.ledger.has(event.eventId)) {
      return null;
    }

    const entry: XpLedgerEntry = {
      ...event,
      points: XP_BY_EVENT[event.type],
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      awardedAt: new Date().toISOString(),
    };
    this.ledger.set(event.eventId, entry);
    return entry;
  }

  getBalance(userId: string): number {
    return this.getLedger(userId).reduce((total, entry) => total + entry.points, 0);
  }

  getLedger(userId: string): XpLedgerEntry[] {
    return [...this.ledger.values()].filter((entry) => entry.userId === userId);
  }

  getTotals(userId: string) {
    const entries = this.getLedger(userId);
    return { userId, totalXp: entries.reduce((total, entry) => total + entry.points, 0), entries };
  }
}
