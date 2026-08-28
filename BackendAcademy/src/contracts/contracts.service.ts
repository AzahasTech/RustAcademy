import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  Payout,
  PayoutActor,
  PayoutAuditEntry,
  PayoutRole,
  PayoutStatus,
} from './contracts.types';

@Injectable()
export class ContractsService {
  private readonly payouts = new Map<string, Payout>();
  private readonly balances = new Map<string, number>();
  private readonly auditLog: PayoutAuditEntry[] = [];

  setBalance(accountId: string, amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Balance must be a non-negative number');
    }
    this.balances.set(accountId, amount);
  }

  createPayout(
    payout: { id: string; recipientId: string; amount: number },
    actor: PayoutActor,
  ): Payout {
    if (!this.isAuthorized(actor)) {
      this.recordAudit('CREATE', payout.id, actor, 'DENIED', 'Unauthorized role');
      throw new ForbiddenException('Actor is not authorized to create payouts');
    }
    if (this.payouts.has(payout.id)) {
      this.recordAudit('CREATE', payout.id, actor, 'REJECTED', 'Duplicate payout');
      throw new ConflictException('Payout already exists');
    }
    if (!Number.isFinite(payout.amount) || payout.amount <= 0) {
      this.recordAudit('CREATE', payout.id, actor, 'REJECTED', 'Invalid amount');
      throw new BadRequestException('Payout amount must be greater than zero');
    }

    const balance = this.balances.get(actor.id) ?? 0;
    if (balance < payout.amount) {
      this.recordAudit('CREATE', payout.id, actor, 'REJECTED', 'Insufficient balance');
      throw new BadRequestException('Insufficient balance for payout');
    }

    this.balances.set(actor.id, balance - payout.amount);
    const created: Payout = {
      ...payout,
      status: 'PENDING',
      createdBy: actor.id,
      createdAt: new Date(),
    };
    this.payouts.set(created.id, created);
    this.recordAudit('CREATE', created.id, actor, 'SUCCESS');
    return created;
  }

  releasePayout(payoutId: string, actor: PayoutActor): Payout {
    const payout = this.getPayout(payoutId);
    if (!this.isAuthorized(actor)) {
      this.recordAudit('RELEASE', payoutId, actor, 'DENIED', 'Unauthorized role');
      throw new ForbiddenException('Actor is not authorized to release payouts');
    }
    if (payout.status !== 'PENDING') {
      this.recordAudit('RELEASE', payoutId, actor, 'REJECTED', `Terminal status: ${payout.status}`);
      throw new ConflictException(`Cannot release a ${payout.status.toLowerCase()} payout`);
    }

    payout.status = 'COMPLETED';
    payout.releasedBy = actor.id;
    payout.releasedAt = new Date();
    this.recordAudit('RELEASE', payoutId, actor, 'SUCCESS');
    return payout;
  }

  failPayout(payoutId: string, actor: PayoutActor): Payout {
    const payout = this.getPayout(payoutId);
    if (!this.isAuthorized(actor)) {
      this.recordAudit('FAIL', payoutId, actor, 'DENIED', 'Unauthorized role');
      throw new ForbiddenException('Actor is not authorized to fail payouts');
    }
    if (payout.status !== 'PENDING') {
      this.recordAudit('FAIL', payoutId, actor, 'REJECTED', `Terminal status: ${payout.status}`);
      throw new ConflictException(`Cannot fail a ${payout.status.toLowerCase()} payout`);
    }
    payout.status = 'FAILED';
    this.recordAudit('FAIL', payoutId, actor, 'SUCCESS');
    return payout;
  }

  getPayout(payoutId: string): Payout {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  getAuditLog(): PayoutAuditEntry[] {
    return this.auditLog.map(entry => ({ ...entry }));
  }

  private isAuthorized(actor: PayoutActor): boolean {
    return Boolean(actor.id) && ['ADMIN', 'TREASURY'].includes(actor.role);
  }

  private recordAudit(
    action: PayoutAuditEntry['action'],
    payoutId: string,
    actor: PayoutActor,
    outcome: PayoutAuditEntry['outcome'],
    reason?: string,
  ): void {
    this.auditLog.push({
      action,
      payoutId,
      actorId: actor.id,
      actorRole: actor.role,
      outcome,
      reason,
      createdAt: new Date(),
    });
  }
}