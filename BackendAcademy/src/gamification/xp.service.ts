import { BadRequestException, ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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

  constructor(private readonly eventBus: DomainEventBus) {}

  onModuleInit(): void {
    this.subscription = this.eventBus.subscribe((event) => this.award(event));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Ensures an award event is published on behalf of the authenticated learner.
   * The event userId is always taken from the authenticated actor, so a learner cannot
   * publish an award for another learner.
   */
  scopeEventToLearner<T extends Pick<XpEvent, 'eventId' | 'type'>>(event: T, actorId?: string): T & { userId: string } {
    if (!actorId) {
      throw new ForbiddenException('Authenticated learner is required to publish XP events');
    }

    const requestedUserId = (event as Pick<XpEvent, 'userId'>).userId;
    if (requestedUserId && requestedUserId !== actorId) {
      throw new ForbiddenException('Cannot publish an XP award event for another learner');
    }

    return { ...event, userId: actorId };
  }

  award(event: XpEvent): XpLedgerEntry | null {
    if (!event.userId) {
      throw new BadRequestException('XP events must be scoped to a learner');
    }

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
