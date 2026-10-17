import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainEventBus } from './domain-event-bus';
import { PublishXpEventDto, XP_AWARD_POLICY } from './dto/publish-xp-event.dto';
import { XpService } from './xp.service';

type AuthenticatedRequest = { user?: { id?: string; userId?: string } };

function resolveRequestUserId(request: AuthenticatedRequest): string | undefined {
  return request.user?.id ?? request.user?.userId;
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
  publish(@Body() event: PublishXpEventDto, @Req() request?: AuthenticatedRequest) {
    const requestUserId = request ? resolveRequestUserId(request) : undefined;
    if (requestUserId && event.userId !== requestUserId) {
      throw new BadRequestException({
        error: '"x" must match the authenticated learner.',
        code: 'XP_AWARD_USER_MISMATCH',
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

  @Get(':userId')
  getTotals(@Param('userId') userId: string, @Req() request?: AuthenticatedRequest) {
    const requestUserId = request ? resolveRequestUserId(request) : undefined;
    if (requestUserId && userId !== requestUserId) {
      throw new BadRequestException({
        error: 'userId must match the authenticated learner.',
        code: 'XP_TOTALS_USER_MISMATCH',
      });
    }

    return this.xpService.getTotals(userId);
  }
}
