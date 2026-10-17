import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainEventBus } from './domain-event-bus';
const XP_AWARD_POLICY: Record<string, number> = {
  lesson_completed: 10,
  quiz_passed: 20,
  course_completed: 100,
};
import { PublishXpEventDto } from './dto/publish-xp-event.dto';
import { XpService } from './xp.service';

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

  @Get(':userId')
  getTotals(@Param('userId') userId: string) {
    return this.xpService.getTotals(userId);
  }
}
