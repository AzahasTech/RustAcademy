import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DomainEventBus } from './domain-event-bus';
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

  it('scopes a published event to the authenticated learner', () => {
    const bus = new DomainEventBus();
    const service = new XpService(bus);
    service.onModuleInit();

    const scoped = service.scopeEventToLearner(
      { eventId: 'evt-2', type: 'task.passed' },
      'user-1',
    );
    bus.publish(scoped);

    expect(service.getBalance('user-1')).toBe(10);
    expect(service.getBalance('user-2')).toBe(0);

    service.onModuleDestroy();
  });

  it('rejects a learner publishing an award event for another learner', () => {
    const bus = new DomainEventBus();
    const service = new XpService(bus);

    expect(() =>
      service.scopeEventToLearner(
        { eventId: 'evt-3', userId: 'user-2', type: 'task.passed' },
        'user-1',
      ),
    ).toThrow(ForbiddenException);
  });

  it('requires an authenticated learner to publish an award event', () => {
    const bus = new DomainEventBus();
    const service = new XpService(bus);

    expect(() =>
      service.scopeEventToLearner(
        { eventId: 'evt-4', userId: 'user-1', type: 'task.passed' },
        undefined,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects awarding an event that is not scoped to a learner', () => {
    const bus = new DomainEventBus();
    const service = new XpService(bus);

    expect(() =>
      service.award({ eventId: 'evt-5', userId: '', type: 'task.passed' }),
    ).toThrow(BadRequestException);
  });
});
