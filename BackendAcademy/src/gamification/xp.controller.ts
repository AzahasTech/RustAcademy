import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainEventBus } from './domain-event-bus';
import { PublishXpEventDto, XP_AWARD_POLICY } from './dto/publish-xp-event.dto';
import { XpService } from './xp.service';

export const XP_HISTORY_DEFAULT_LIMIT = 20;
export const XP_HISTORY_MAX_LIMIT = 100;

export interface XpHistoryQuery {
  limit?: number | string;
  cursor?: string;
}

export interface XpHistoryResult {
  items: unknown[];
  limit: number;
  nextCursor: string | null;
}

function parseLimit(raw: number | string | undefined): number {
  if (raw === undefined) {
    return XP_HISTORY_DEFAULT_LIMIT;
  }

  const limit = typeof raw === 'number' ? raw : Number(raw);

  if (!Number.isInteger(limit) || limit < 1 || limit > XP_HISTORY_MAX_LIMIT) {
    throw new BadRequestException({
      error: `"limit" must be an integer between 1 and ${XP_HISTORY_MAX_LIMIT}.`,
      code: 'INVALID_XP_HISTORY_LIMIT',
    });
  }

  return limit;
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === '') {
    return 0;
  }

  const offset = Number(cursor);

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestException({
      error: '"cursor" must be a non-negative integer offset.',
      code: 'INVALID_XP_HISTORY_CURSOR',
    });
  }

  return offset;
}

@ApiTags('xp')
@Controller('v1/xp')
export class XpController {
  constructor(
    private readonly eventBus: DomainEventBus,
    private readonly xpService: XpService,
  ) {}

  @Post('events')
  @ApiOperation({ summary: 'Publish a domain event for XP awarding' })
  publish(@Body() event: PublishXpEventDto) {
    if (!this.xpService.canPublishFor(event.userId)) {
      throw new BadRequestException({
        error: 'Cannot publish an XP event for another learner.',
        code: 'XP_PUBLISH_LEARNER_SCOPE_VIOLATED',
      });
    }

    if (
      event.amount !== undefined &&
      (!Number.isInteger(event.amount) ||
        event.amount < 5 ||
        event.amount > 100 ||
        event.amount !== XP_AWARD_POLICY[event.type])
    ) {
      throw new BadRequestException({
        error: '"amount" must match the configured XP award for this event.',
        code: 'INVALID_XP_AWARD_AMOUNT',
      });
    }

    this.eventBus.publish(event);
    return { accepted: true, eventId: event.eventId, totalXp: this.xpService.getBalance(event.userId) };
  }

  @Get(':userId/history')
  @ApiOperation({ summary: 'Get a bounded, paginated XP ledge history' })
  getHistory(@Param('userId') userId: string, @Query() query: XpHistoryQuery): XpHistoryResult {
    const limit = parseLimit(query.limit);
    const offset = decodeCursor(query.cursor);
    const ledger = this.xpService.getLedger(userId);
    const items = ledger.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const nextCursor = nextOffset < ledger.length ? String(nextOffset) : null;

    return { items, limit, nextCursor };
  }

  @Get(':userId')
  getTotals(@Param('userId') userId: string) {
    return this.xpService.getTotals(userId);
  }
}