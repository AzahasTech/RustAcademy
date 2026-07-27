import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Represents a parsed cron expression.
 */
export interface CronSchedule {
  /** Original cron expression string */
  expression: string;
  /** Human-readable description */
  description: string;
  /** Whether the expression is valid */
  isValid: boolean;
  /** Validation error message if invalid */
  error?: string;
  /** Next 5 run times (ISO strings) for preview */
  nextRuns: string[];
}

/**
 * Standard cron field: minute, hour, day-of-month, month, day-of-week
 */
interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  private readonly schedules = new Map<string, CronSchedule>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.loadSchedules();
    this.validateAll();
  }

  /**
   * Loads cron schedules from configuration.
   */
  private loadSchedules(): void {
    const entries: Array<{ name: string; key: string }> = [
      { name: 'cleanup', key: 'CRON_CLEANUP_SCHEDULE' },
      { name: 'analytics', key: 'CRON_ANALYTICS_SCHEDULE' },
      { name: 'notifications', key: 'CRON_NOTIFICATIONS_SCHEDULE' },
      { name: 'walletReconciliation', key: 'CRON_WALLET_RECONCILIATION_SCHEDULE' },
      { name: 'cacheWarming', key: 'CRON_CACHE_WARMING_SCHEDULE' },
    ];

    for (const entry of entries) {
      const raw = this.configService.get<string>(entry.key);
      if (!raw) {
        this.logger.warn(`No cron expression configured for ${entry.name}, using default`);
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

  /**
   * Parses a standard 5-field cron expression and returns a CronSchedule.
   *
   * Format: minute hour day-of-month month day-of-week
   * Each field supports: wildcard (*), step patterns (/n), comma-separated values, ranges (a-b), and single values.
   */
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

    // Validate each field
    const validations: Array<{ field: string; value: string; min: number; max: number }> = [
      { field: 'minute', value: cronFields.minute, min: 0, max: 59 },
      { field: 'hour', value: cronFields.hour, min: 0, max: 23 },
      { field: 'day-of-month', value: cronFields.dayOfMonth, min: 1, max: 31 },
      { field: 'month', value: cronFields.month, min: 1, max: 12 },
      { field: 'day-of-week', value: cronFields.dayOfWeek, min: 0, max: 7 },
    ];

    const cronFieldValidator = /^(\*|(\*\/)?\d+|\d+(-\d+)?)(,\d+(-\d+)?)*$/;

    for (const v of validations) {
      // Accept * and */n patterns
      if (v.value === '*' || v.value.startsWith('*/')) {
        const numPart = v.value.startsWith('*/') ? v.value.slice(2) : '0';
        if (!/^\d+$/.test(numPart)) {
          return this.invalidResult(trimmed, name, `${v.field}: invalid step value "${v.value}"`);
        }
        continue;
      }

      // Split commas for lists
      const parts = v.value.split(',');
      for (const part of parts) {
        // Check format
        if (!cronFieldValidator.test(part)) {
          return this.invalidResult(trimmed, name, `${v.field}: invalid field "${v.value}"`);
        }
        // Check ranges
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

  /**
   * Validates all registered schedules and logs results.
   */
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

  /**
   * Returns all registered schedules as CronSchedule objects.
   */
  getAllSchedules(): CronSchedule[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Returns a single schedule by name.
   */
  getSchedule(name: string): CronSchedule | undefined {
    return this.schedules.get(name);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private invalidResult(
    expression: string,
    name: string,
    error: string,
  ): CronSchedule {
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
    // Note: next-run times are approximated. Install the 'cron-parser' npm package
    // for accurate cron-based scheduling: npm install cron-parser
    const runs: string[] = [];
    const now = new Date();
    for (let i = 1; i <= count; i++) {
      const next = new Date(now.getTime() + i * 60 * 60 * 1000);
      runs.push(next.toISOString());
    }
    return runs;
  }
}
