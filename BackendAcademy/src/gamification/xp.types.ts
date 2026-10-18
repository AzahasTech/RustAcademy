export type XpEventType =
  |'task.passed'
  |'course.completed'
  |'streak.day'
  |'contribution.created';

export interface XpEvent {
  eventId: string;
  userId: string;
  type: XpEventType;
  /** Accepted event time. Normalized to UTC ISO 8601 when accepted. */
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface XpLedgerEntry extends XpEvent {
  points: number;
  /** UTC ISO 8601 timestamp of when the entry was awarded. */
  awardedAt: string;
}

export interface XpApplyResult {
  applied: boolean;
  duplicate: boolean;
  entry?: XpLedgerEntry;
}
