import { Keypair } from '@stellar/stellar-sdk';
import { HorizonService } from './horizon.service';
import { StellarService } from './stellar.service';

describe('HorizonService', () => {
  it('normalizes paginated operations and clamps the page size', async () => {
    const publicKey = Keypair.random().publicKey();
    const record = {
      id: 'operation-id',
      paging_token: 'next-page-token',
      type: 'payment',
      created_at: '2026-01-01T00:00:00Z',
      source_account: publicKey,
      transaction_hash: 'transaction-hash',
      amount: '1.5000000',
      asset_type: 'native',
      to: 'GDESTINATION',
    };
    const call = jest.fn().mockResolved({ records: [record] });
    const cursor = jest.fn().mockReturnValue({ call });
    const limit = jest.fn().mockReturnValue({ cursor, call });
    const order = jest.fn().mockReturnValue({ limit });
    const forAccount = jest.fn().mockReturnValue({ order });
    const operations = jest.fn().mockReturnValue({ forAccount });
    const service = new HorizonService({ server: { operations } } as unknown as StellarService);

    const result = await service.getHistory(publicKey, 500, 'previous-token');

    expect(limit).toHaveBeenCalledWith(100);
    expect(cursor).toHaveBeenCalledWith('previous-token');
    expect(result.operations[0]).toMatchObject({
      id: 'operation-id',
      type: 'payment',
      amount: '1.5000000',
      assetCode: 'XLM',
      transactionHash: 'transaction-hash',
    });
    expect(result.nextCursor).toBe('next-page-token');
  });

  it('rejects malformed public keys before issuing Horizon requests', async () => {
    const operations = jest.fn();
    const service = new HorizonService({ server: { operations } } as unknown as StellarService);

    await expect(service.getHistory('not-a-valid-key')).rejects.toThrow(/Invalid Stellar account ID/);
    expect(operations).not.toHaveBeenCalled();
  });

  it('maps missing accounts to a safe not-found error', async () => {
    const publicKey = Keypair.random().publicKey();
    const loadAccount = jest.fn().mockRejected({
      response: {
        status: 404,
        data: { type: 'https://developers.stellar.org/horizon/errors/not_found', title: 'Resource Missing', status: 404 },
      },
    });
    const service = new HorizonService({ server: { loadAccount } } as unknown as StellarService);

    await expect(service.getAccount(publicKey)).rejects.toMatchObject({
      message: 'Stellar account not found',
      status: 404,
    });
  });

  it('returns a stable service-unavailable error without exposing upstream payloads', async () => {
    const publicKey = Keypair.random().publicKey();
    const upstreamPayload = {
      type: 'https://developers.stellar.org/horizon/errors/server_error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'upstream internal details',
    };
    const call = jest.fn().mockRejected({ response: { status: 500, data: upstreamPayload } });
    const limit = jest.fn().mockReturnValue({ call });
    const order = jest.fn().mockReturnValue({ limit });
    const forAccount = jest.fn().mockReturnValue({ order });
    const operations = jest.fn().mockReturnValue({ forAccount });
    const service = new HorizonService({ server: { operations } } as unknown as StellarService);

    await expect(service.getHistory(publicKey)).rejects.toMatchObject({
      message: 'Unable to fetch Stellar transaction history',
      status: 503,
    });
  });
    await expect(service.getHistory('not-a-valid-key')).rejects.toThrow(/Invalid Stellar public key/);
    expect(operations).not.toHaveBeenCalled();
  });
});
