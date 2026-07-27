import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isFeatureEnabled } from '../config/env.schema';

/**
 * Represents a parsed cron expression.
 */
export interface CronSchedule {
  expression: string;
  description: string;
  isValid: boolean;
  error?: string;
  nextRuns: string[];
}

interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

/**
 * Result of a contract event replay job execution.
 */
export interface ReplayJobResult {
  jobId: string;
  contractId: string;
  eventsProcessed: number;
  status: 'completed' | 'failed';
  executedAt: Date;
  durationMs: number;
  error?: string;
}

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private readonly schedules = new Map<string, CronSchedule>();

  /** #394: History of replay job executions */
  private readonly replayJobHistory: ReplayJobResult[] = [];

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.loadSchedules();
    this.validateAll();

    // #394: Log replay availability
    const replayEnabled = isFeatureEnabled(
      this.configService.get<string>('CONTRACT_EVENT_REPLAY_ENABLED'),
    );
    if (replayEnabled) {
      this.logger.log('Contract event replay jobs are ENABLED');
    } else {
      this.logger.log(
        'Contract event replay jobs are DISABLED. ' +
          'Set CONTRACT_EVENT_REPLAY_ENABLED=true to enable.',
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Existing schedule management
  // ──────────────────────────────────────────────────────────────────

  private loadSchedules(): void {
    const entries: Array<{ name: string; key: string }> = [
      { name: 'cleanup', key: 'CRON_CLEANUP_SCHEDULE' },
      { name: 'analytics', key: 'CRON_ANALYTICS_SCHEDULE' },
      { name: 'notifications', key: 'CRON_NOTIFICATIONS_SCHEDULE' },
      // #394: Replay schedule for periodic event replay
      { name: 'contract_replay', key: 'CRON_CONTRACT_REPLAY_SCHEDULE' },
    ];

    for (const entry of entries) {
      const raw = this.configService.get<string>(entry.key);
      if (!raw) {
        this.logger.warn(
          `No cron expression configured for ${entry.name}, using default`,
        );
        continue;
      }
      const schedule = this.parseCron(raw, entry.name);
      if (!schedule.isValid) {
        this.logger.error(
          `Invalid cron expression for ${entry.name}: "${raw}" — ${schedule.error}`,
        );
      }
      this.schedules.set(entry.name, schedule);
    }
  }

  parseCron(expression: string, name: string): CronSchedule {
    const trimmed = expression.trim();
    const fields = trimmed.split(/\s+/);

    if (fields.length !== 5) {
      return {
        expression: trimmed,
        description: `Unknown schedule for ${name}`,
        isValid: false,
        error: `Cron expression must have exactly 5 fields (got ${fields.length}): "${trimmed}"`,
        nextRuns: [],
      };
    }

    const cronFields: CronFields = {
      minute: fields[0],
      hour: fields[1],
      dayOfMonth: fields[2],
      month: fields[3],
      dayOfWeek: fields[4],
    };

    const validations: Array<{ field: string; value: string; min: number; max: number }> = [
      { field: 'minute', value: cronFields.minute, min: 0, max: 59 },
      { field: 'hour', value: cronFields.hour, min: 0, max: 23 },
      { field: 'day-of-month', value: cronFields.dayOfMonth, min: 1, max: 31 },
      { field: 'month', value: cronFields.month, min: 1, max: 12 },
      { field: 'day-of-week', value: cronFields.dayOfWeek, min: 0, max: 7 },
    ];

    const cronFieldValidator = /^(\*|(\*\/)?\d+|\d+(-\d+)?)(,\d+(-\d+)?)*$/;

    for (const v of validations) {
      if (v.value === '*' || v.value.startsWith('*/')) {
        const numPart = v.value.startsWith('*/') ? v.value.slice(2) : '0';
        if (!/^\d+$/.test(numPart)) {
          return this.invalidResult(trimmed, name, `${v.field}: invalid step value "${v.value}"`);
        }
        continue;
      }

      const parts = v.value.split(',');
      for (const part of parts) {
        if (!cronFieldValidator.test(part)) {
          return this.invalidResult(trimmed, name, `${v.field}: invalid field "${v.value}"`);
        }
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(Number);
          if (start < v.min || end > v.max || start > end) {
            return this.invalidResult(
              trimmed,
              name,
              `${v.field}: range ${start}-${end} is out of bounds (${v.min}-${v.max})`,
            );
          }
        } else {
          const num = Number(part);
          if (num < v.min || num > v.max) {
            return this.invalidResult(
              trimmed,
              name,
              `${v.field}: value ${num} is out of bounds (${v.min}-${v.max})`,
            );
          }
        }
      }
    }

    const description = this.describeCron(cronFields, name);
    const nextRuns = this.computeNextRuns(expression, 5);

    return {
      expression: trimmed,
      description,
      isValid: true,
      nextRuns,
    };
  }

  validateAll(): Array<{ name: string; valid: boolean; error?: string }> {
    const results: Array<{ name: string; valid: boolean; error?: string }> = [];
    for (const [name, schedule] of this.schedules) {
      results.push({
        name,
        valid: schedule.isValid,
        error: schedule.error,
      });
    }
    return results;
  }

  getAllSchedules(): CronSchedule[] {
    return Array.from(this.schedules.values());
  }

  getSchedule(name: string): CronSchedule | undefined {
    return this.schedules.get(name);
  }

  // ──────────────────────────────────────────────────────────────────
  // #394: Event replay job support
  // ──────────────────────────────────────────────────────────────────

  /**
   * Records a replay job execution result for audit trail.
   */
  recordReplayJob(result: ReplayJobResult): void {
    this.replayJobHistory.push(result);
    this.logger.log(
      `Replay job recorded: ${result.jobId} (${result.status}) — ${result.eventsProcessed} events in ${result.durationMs}ms`,
    );

    // Limit history size
    if (this.replayJobHistory.length > 1000) {
      this.replayJobHistory.splice(0, this.replayJobHistory.length - 1000);
    }
  }

  /**
   * Returns replay job execution history.
   */
  getReplayJobHistory(limit?: number): ReplayJobResult[] {
    const history = [...this.replayJobHistory];
    history.sort(
      (a, b) => b.executedAt.getTime() - a.executedAt.getTime(),
    );
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Checks whether the contract replay feature is enabled.
   */
  isReplayEnabled(): boolean {
    return isFeatureEnabled(
      this.configService.get<string>('CONTRACT_EVENT_REPLAY_ENABLED'),
    );
  }

  /**
   * Checks whether contract ingestion is enabled.
   */
  isIngestionEnabled(): boolean {
    return isFeatureEnabled(
      this.configService.get<string>('CONTRACT_INGESTION_ENABLED'),
    );
  }

  // ── Private helpers ──────────────────────────────────────────────

  private invalidResult(expression: string, name: string, error: string): CronSchedule {
    return {
      expression,
      description: `Invalid schedule for ${name}`,
      isValid: false,
      error,
      nextRuns: [],
    };
  }

  private describeCron(fields: CronFields, name: string): string {
    const desc = [];
    const minute = fields.minute;
    const hour = fields.hour;

    if (minute === '*' && hour === '*') {
      desc.push('Runs every minute');
    } else if (minute.startsWith('*/') && hour === '*') {
      desc.push(`Runs every ${minute.slice(2)} minutes`);
    } else if (hour.startsWith('*/') && minute === '0') {
      desc.push(`Runs every ${hour.slice(2)} hours`);
    } else if (minute === '0' && hour === '0') {
      desc.push('Runs at midnight');
    } else {
      desc.push(`Runs at ${hour}:${minute.padStart(2, '0')}`);
    }

    desc.push(`(${name})`);
    return desc.join(' ');
  }

  private computeNextRuns(_expression: string, count: number): string[] {
    const runs: string[] = [];
    const now = new Date();
    for (let i = 1; i <= count; i++) {
      const next = new Date(now.getTime() + i * 60 * 60 * 1000);
      runs.push(next.toISOString());
    }
    return runs;
  }

  // ---------------------------------------------------------------------------
  // Webhook Retry Scheduling — Issue #412
  // ---------------------------------------------------------------------------

  /** Queue of pending webhook retries, keyed by webhookId. */
  private readonly pendingWebhookRetries = new Map<string, {
    webhookId: string;
    attempt: number;
    nextRetryAt: Date;
    lastError?: string;
  }>();

  /**
   * Schedules a webhook retry with exponential backoff and jitter.
   */
  scheduleWebhookRetry(
    webhookId: string,
    attempt: number,
    baseBackoffMs: number,
    maxBackoffMs: number,
  ): Date {
    const exponential = Math.min(baseBackoffMs * Math.pow(2, attempt - 1), maxBackoffMs);
    const jitter = exponential * (0.5 + Math.random() * 0.5);
    const nextRetryAt = new Date(Date.now() + Math.floor(jitter));

    this.pendingWebhookRetries.set(webhookId, {
      webhookId,
      attempt,
      nextRetryAt,
    });

    this.logger.log(
      `Scheduled webhook retry for ${webhookId} attempt ${attempt} at ${nextRetryAt.toISOString()}`,
    );
    return nextRetryAt;
  }

  /**
   * Returns all webhook retries that are due for execution.
   */
  getDueWebhookRetries(): Array<{ webhookId: string; attempt: number }> {
    const now = new Date();
    const due: Array<{ webhookId: string; attempt: number }> = [];
    for (const [id, entry] of this.pendingWebhookRetries) {
      if (entry.nextRetryAt <= now) {
        due.push({ webhookId: id, attempt: entry.attempt });
        this.pendingWebhookRetries.delete(id);
      }
    }
    return due;
  }

  /**
   * Removes a scheduled retry (e.g. on successful delivery).
   */
  cancelWebhookRetry(webhookId: string): boolean {
    return this.pendingWebhookRetries.delete(webhookId);
  }
}
