import { ConfigService } from '@nestjs/config';
import { PaymentsService, PaymentWebhookEvent } from './payments.service';
import { DatabaseService } from '../database/database.service';
import { IContractAdapter } from '../contracts';

/**
 * #665: These tests exercise PaymentsService construction with the required
 * `DatabaseService` collaborator and with the optional collaborators
 * (`IContractAdapter`, `ConfigService`) so regressions in dependency wiring
 * are caught at unit-test level.
 */
type DatabaseServiceMock = {
  getPaymentById: jest.Mock;
  createPayment: jest.Mock;
  updatePaymentStatus: jest.Mock;
  validateCoupon: jest.Mock;
  applyCoupon: jest.Mock;
  getRedemptionsByUser: jest.Mock;
  getAllCoupons: jest.Mock;
};

function createDatabaseServiceMock(): DatabaseServiceMock {
  return {
    getPaymentById: jest.fn(),
    createPayment: jest.fn(),
    updatePaymentStatus: jest.fn(),
    validateCoupon: jest.fn(),
    applyCoupon: jest.fn(),
    getRedemptionsByUser: jest.fn(),
    getAllCoupons: jest.fn(),
  };
}

describe('PaymentsService construction', () => {
  let databaseServiceMock: DatabaseServiceMock;

  beforeEach(() => {
    databaseServiceMock = createDatabaseServiceMock();
  });

  it('instantiates with only the required DatabaseService collaborator', () => {
    const service = new PaymentsService(
      databaseServiceMock as unknown as DatabaseService,
    );
    expect(service).toBeDefined();
  });

  it('instantiates with required and optional collaborators', () => {
    const contractAdapterMock = {
      recordPayment: jest.fn(),
    } as unknown as IContractAdapter;
    const configServiceMock = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const service = new PaymentsService(
      databaseServiceMock as unknown as DatabaseService,
      contractAdapterMock,
      configServiceMock,
    );
    expect(service).toBeDefined();
  });

  it('applies default webhook tuning when ConfigService is absent', () => {
    const service = new PaymentsService(
      databaseServiceMock as unknown as DatabaseService,
    );
    // Base backoff defaults to 1000ms with jitter in [0.5x, 1x].
    const delay = service.calculateRetryDelay(1);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it('reads webhook tuning values from ConfigService when provided', () => {
    const configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'WEBHOOK_BASE_BACKOFF_MS') return 2000;
        if (key === 'WEBHOOK_MAX_BACKOFF_MS') return 8000;
        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new PaymentsService(
      databaseServiceMock as unknown as DatabaseService,
      undefined,
      configServiceMock,
    );
    const delay = service.calculateRetryDelay(1);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(2000);
  });
});

describe('PaymentsService webhook processing', () => {
  let databaseServiceMock: DatabaseServiceMock;
  let service: PaymentsService;

  const event: PaymentWebhookEvent = {
    eventId: 'evt-1',
    paymentId: 'pay-1',
    orderId: 'ord-1',
    userId: 'usr-1',
    status: 'succeeded',
    amount: 100,
    assetCode: 'XLM',
    provider: 'test-provider',
  };

  beforeEach(() => {
    databaseServiceMock = createDatabaseServiceMock();
    service = new PaymentsService(
      databaseServiceMock as unknown as DatabaseService,
    );
  });

  it('creates a pending payment row on first callback and applies a legal transition', async () => {
    databaseServiceMock.getPaymentById.mockResolvedValue(null);
    databaseServiceMock.createPayment.mockResolvedValue({ id: 'pay-1' });
    databaseServiceMock.updatePaymentStatus.mockResolvedValue({
      success: true,
      transitioned: true,
    });

    const result = await service.processPaymentWebhookEvent(event);

    expect(databaseServiceMock.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay-1', status: 'pending' }),
    );
    expect(result).toEqual({ outcome: 'applied', paymentId: 'pay-1', status: 'succeeded' });
  });

  it('rejects illegal transitions without mutating state', async () => {
    databaseServiceMock.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    databaseServiceMock.updatePaymentStatus.mockResolvedValue({
      success: false,
      transitioned: false,
      reason: 'Illegal transition for payment pay-1: succeeded -> pending',
    });

    const result = await service.processPaymentWebhookEvent({
      ...event,
      status: 'pending',
    });

    expect(result.outcome).toBe('rejected');
    expect(databaseServiceMock.applyCoupon).not.toHaveBeenCalled();
  });

  it('recognizes duplicate events as safe no-ops', async () => {
    databaseServiceMock.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    databaseServiceMock.updatePaymentStatus.mockResolvedValue({
      success: true,
      transitioned: false,
      duplicateEvent: true,
      reason: 'Event evt-1 already applied',
    });

    const result = await service.processPaymentWebhookEvent(event);

    expect(result.outcome).toBe('duplicate');
    expect(databaseServiceMock.applyCoupon).not.toHaveBeenCalled();
  });

  it('grants a coupon redemption only on a genuine first-time success transition', async () => {
    databaseServiceMock.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    databaseServiceMock.updatePaymentStatus.mockResolvedValue({
      success: true,
      transitioned: true,
    });
    databaseServiceMock.applyCoupon.mockResolvedValue({
      success: true,
      finalAmount: 90,
      discountApplied: 10,
    });

    const result = await service.processPaymentWebhookEvent({
      ...event,
      couponCode: 'STELLAR10',
    });

    expect(result.outcome).toBe('applied');
    expect(databaseServiceMock.applyCoupon).toHaveBeenCalledWith(
      'STELLAR10',
      'usr-1',
      100,
      'ord-1',
    );
  });

  it('does not apply a coupon when the transition is a no-op', async () => {
    databaseServiceMock.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    databaseServiceMock.updatePaymentStatus.mockResolvedValue({
      success: true,
      transitioned: false,
      alreadyInStatus: true,
      reason: 'already in status',
    });

    const result = await service.processPaymentWebhookEvent({
      ...event,
      couponCode: 'STELLAR10',
    });

    expect(result.outcome).toBe('noop');
    expect(databaseServiceMock.applyCoupon).not.toHaveBeenCalled();
  });
});

describe('PaymentsService transaction history', () => {
  it('paginates the stub ledger and exposes a next cursor when more entries remain', () => {
    const service = new PaymentsService(
      createDatabaseServiceMock() as unknown as DatabaseService,
    );

    const page1 = service.getTransactionHistory({ limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.total).toBe(4);
    expect(page1.nextCursor).toBe('2');

    const page2 = service.getTransactionHistory({ limit: 2, cursor: '2' });
    expect(page2.entries).toHaveLength(2);
    expect(page2.nextCursor).toBeUndefined();
  });
});
