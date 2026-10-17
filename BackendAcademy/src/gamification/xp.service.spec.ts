import { BadRequestException } from '@nestjs/common';
import { DomainEventBus } from './domain-event-bus';
import { XpController } from './xp.controller';
import { XpService } from './xp.service';

describe('XpService', () => {
  it('awards an event once when the event is replayed', () => {
    const bus = new DomainEventBus();
    const service = new XpService(bus);
    service.onModuleInit();

    const event = { eventId: 'evt-1', userId: 'user-1', type: 'task.passed' as const };
    bus.publish(event);
    bus.publish(event);

    expect(service.getBalance('user-1')).toBe(10);
    expect(service.getLedger('user-1')).toHaveLength(1);
    expect(service.getTotals('user-1').totalXp).toBe(10);

    service.onModuleDestroy();
  });

  describe('XP award amount validation', () => {
    let bus: DomainEventBus;
    let service: XpService;
    let controller: XpController;

    beforeEach(() => {
      bus = new DomainEventBus();
      service = new XpService(bus);
      service.onModuleInit();
      controller = new XpController(bus, service);
    });

    afterEach(() => service.onModuleDestroy());

    it.each([
      ['streak.day', 5],
      ['task.passed', 10],
      ['contribution.created', 25],
      ['course.completed', 100],
    ] as const)('accepts configured award %s = %i XP', (type, amount) => {
      expect(
        controller.publish({ eventId: `evt-${type}`, userId: 'user-1', type, amount }, { user: { id: 'user-1' } }),
      ).toMatchObject({ accepted: true });
      expect(service.getBalance('user-1')).toBe(amount);
    });

    it.each([
      ['negative amount', 'task.passed', -1],
      ['above policy maximum', 'course.completed', 101],
      ['fractional amount', 'task.passed', 10.5],
      ['amount that conflicts with event policy', 'streak.day', 10],
    ] as const)('rejects %s', (_description, type, amount) => {
      expect(() =>
        controller.publish({ eventId: 'evt-invalid', userId: 'user-1', type, amount }, { user: { id: 'user-1' } }),
      ).toThrow(BadRequestException);
      expect(service.getBalance('user-1')).toBe(0);
    });

    it('prevents a learner from publishing an award for another learner', () => {
      expect(() =>
        controller.publish(
          { eventId: 'evt-cross-user', userId: 'user-2', type: 'task.passed' },
          { user: { id: 'user-1' } },
        ),
      ).toThrow(BadRequestException);
      expect(service.getBalance('user-2')).toBe(0);
      expect(service.getBalance('user-1')).toBe(0);
    });

    it('prevents a learner from reading another learner\'s totals', () => {
      expect(() => controller.getTotals('user-2', { user: { id: 'user-1' } })).toThrow(
        BadRequestException,
      );
    });
  });
});
