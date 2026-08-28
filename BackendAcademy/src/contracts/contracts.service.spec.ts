import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';

describe('ContractsService', () => {
  let service: ContractsService;
  const treasury = { id: 'treasury-1', role: 'TREASURY' as const };
  const learner = { id: 'learner-1', role: 'ADMIN' as const };
  const unauthorized = { id: 'user-1', role: 'LEARNER' as never };

  beforeEach(() => {
    service = new ContractsService();
    service.setBalance(treasury.id, 100);
  });

  it('creates a pending payout only when the actor has sufficient balance', () => {
    const payout = service.createPayout(
      { id: 'payout-1', recipientId: learner.id, amount: 25 },
      treasury,
    );

    expect(payout.status).toBe('PENDING');
    expect(() => service.createPayout(
      { id: 'payout-2', recipientId: learner.id, amount: 76 },
      treasury,
    )).toThrow(BadRequestException);
  });

  it('rejects duplicate payouts and unauthorized creation', () => {
    service.createPayout(
      { id: 'payout-1', recipientId: learner.id, amount: 25 },
      treasury,
    );

    expect(() => service.createPayout(
      { id: 'payout-1', recipientId: learner.id, amount: 25 },
      treasury,
    )).toThrow(ConflictException);
    service.setBalance('user-2', 25);
    expect(() => service.createPayout(
      { id: 'payout-2', recipientId: learner.id, amount: 25 },
      { id: 'user-2', role: 'ADMIN' },
    )).not.toThrow();
    expect(() => service.createPayout(
      { id: 'payout-3', recipientId: learner.id, amount: 25 },
      { id: 'user-3', role: 'INVALID' as never },
    )).toThrow(ForbiddenException);
  });

  it('allows authorized release and rejects every terminal state', () => {
    service.createPayout(
      { id: 'payout-1', recipientId: learner.id, amount: 25 },
      treasury,
    );

    expect(service.releasePayout('payout-1', treasury).status).toBe('COMPLETED');
    expect(() => service.releasePayout('payout-1', treasury)).toThrow(ConflictException);

    service.createPayout(
      { id: 'payout-2', recipientId: learner.id, amount: 25 },
      treasury,
    );
    service.failPayout('payout-2', treasury);
    expect(() => service.releasePayout('payout-2', treasury)).toThrow(ConflictException);
  });

  it('audits successful and rejected actions', () => {
    service.createPayout(
      { id: 'payout-1', recipientId: learner.id, amount: 25 },
      treasury,
    );
    expect(() => service.releasePayout('payout-1', unauthorized)).toThrow(ForbiddenException);
    service.releasePayout('payout-1', treasury);

    expect(service.getAuditLog().map(entry => [entry.action, entry.outcome])).toEqual([
      ['CREATE', 'SUCCESS'],
      ['RELEASE', 'DENIED'],
      ['RELEASE', 'SUCCESS'],
    ]);
  });
});