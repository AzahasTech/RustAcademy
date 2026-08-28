import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { PayoutActor, PayoutRole } from './contracts.types';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post('payouts')
  createPayout(
    @Body() body: { id: string; recipientId: string; amount: number },
    @Headers('x-actor-id') actorId: string,
    @Headers('x-actor-role') actorRole: PayoutRole,
  ) {
    return this.contractsService.createPayout(body, this.actor(actorId, actorRole));
  }

  @Post('payouts/:id/release')
  releasePayout(
    @Param('id') payoutId: string,
    @Headers('x-actor-id') actorId: string,
    @Headers('x-actor-role') actorRole: PayoutRole,
  ) {
    return this.contractsService.releasePayout(payoutId, this.actor(actorId, actorRole));
  }

  @Post('payouts/:id/fail')
  failPayout(
    @Param('id') payoutId: string,
    @Headers('x-actor-id') actorId: string,
    @Headers('x-actor-role') actorRole: PayoutRole,
  ) {
    return this.contractsService.failPayout(payoutId, this.actor(actorId, actorRole));
  }

  @Get('payouts/:id')
  getPayout(@Param('id') payoutId: string) {
    return this.contractsService.getPayout(payoutId);
  }

  @Get('audit')
  getAuditLog() {
    return this.contractsService.getAuditLog();
  }

  private actor(id: string, role: PayoutRole): PayoutActor {
    return { id, role };
  }
}