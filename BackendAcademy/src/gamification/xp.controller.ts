import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainEventBus } from './domain-event-bus';
import { PublishXpEventDto } from './dto/publish-xp-event.dto';
import { XpService } from './xp.service';

export interface AuthenticatedRequest {
  user?: {
    id?: string;
    userId?: string;
  };
  userId?: string;
  actorId?: string;
}

function resolveRequestUserId(request: AuthenticatedRequest): string | undefined {
  return request.user?.id ?? request.user?.userId ?? request.userId ?? request.actorId;
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
  publish(@Body() event: PublishXpEventDto, @Req() request: AuthenticatedRequest) {
    const actorId = resolveRequestUserId(request);
    const scopedEvent = this.xpService.scopeEventToLearner(event, actorId);
    if (!scopedEvent) {
      return { accepted: false, reason: 'learner-scope-mismatch' };
    }
    this.eventBus.publish(scopedEvent);
    return {
      accepted: true,
      eventId: scopedEvent.eventId,
      totalXp: this.xpService.getBalance(scopedEvent.userId),
    };
  }

  @Get(':userId')
  getTotals(@Param('userId') userId: string) {
    return this.xpService.getTotals(userId);
  }
}
