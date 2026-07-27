import { Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';
import {
  StellarTransaction,
  TransactionHistoryResponse,
} from './interfaces/transaction.interface';
import { IContractAdapter } from '../contracts';

/**
 * Payments service.
 *
 * #396: On-chain payment recording is isolated behind the
 * {@link IContractAdapter} interface. When the adapter is available,
 * payment events are recorded on-chain for auditability. When it is
 * not available (e.g., test environments), the service operates
 * in off-chain-only mode.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private readonly stubLedger: StellarTransaction[] = [
    {
      id: 'tx-stub-0001',
      account: 'GACCOUNT-STUB-1',
      hash: 'a1b2c3d4e5f60001',
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      type: 'payment',
      amount: '100.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
      memo: 'course enrollment',
      successful: true,
    },
    {
      id: 'tx-stub-0002',
      account: 'GACCOUNT-STUB-1',
      hash: 'a1b2c3d4e5f60002',
      createdAt: new Date(Date.now() - 172_800_000).toISOString(),
      type: 'payment',
      amount: '25.0000000',
      assetCode: 'USDC',
      assetIssuer: 'GISSUER-STUB-USDC',
      memo: 'badge mint',
      successful: true,
    },
    {
      id: 'tx-stub-0003',
      account: 'GACCOUNT-STUB-1',
      hash: 'a1b2c3d4e5f60003',
      createdAt: new Date(Date.now() - 259_200_000).toISOString(),
      type: 'path_payment',
      amount: '50.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
      memo: 'reward claim',
      successful: true,
    },
    {
      id: 'tx-stub-0004',
      account: 'GACCOUNT-STUB-1',
      hash: 'a1b2c3d4e5f60004',
      createdAt: new Date(Date.now() - 345_600_000).toISOString(),
      type: 'create_account',
      amount: '1.0000000',
      assetCode: 'XLM',
      assetIssuer: null,
      memo: '',
      successful: true,
    },
  ];

  private static readonly MAX_LIMIT = 100;
  private static readonly DEFAULT_LIMIT = 20;

  constructor(
    private readonly databaseService: DatabaseService,
    @Optional()
    private readonly contractAdapter?: IContractAdapter,
  ) {}

  getTransactionHistory(query: TransactionHistoryQueryDto): TransactionHistoryResponse {
    const { account, limit, cursor } = query;

    let filtered = [...this.stubLedger];
    if (account) {
      filtered = filtered.filter((tx) => tx.account === account);
    }

    const effectiveLimit = Math.min(
      Math.max(1, Number(limit) || PaymentsService.DEFAULT_LIMIT),
      PaymentsService.MAX_LIMIT,
    );

    const startIdx = cursor ? parseInt(cursor, 10) || 0 : 0;
    const page = filtered.slice(startIdx, startIdx + effectiveLimit);
    const remaining = filtered.length - (startIdx + page.length);

    const response: TransactionHistoryResponse = {
      entries: page,
      total: filtered.length,
    };
    if (remaining > 0) {
      response.nextCursor = String(startIdx + page.length);
    }
    return response;
  }

  async validateCoupon(code: string, userId: string, amount: number) {
    return this.databaseService.validateCoupon(code, userId, amount);
  }

  async applyCoupon(code: string, userId: string, amount: number, orderId: string) {
    const result = await this.databaseService.applyCoupon(code, userId, amount, orderId);

    // ── #396: Record payment on-chain via contract adapter ──────────
    if (this.contractAdapter) {
      try {
        await this.contractAdapter.recordPayment(
          userId,
          'platform',
          amount,
          'XLM',
          `Coupon redemption: ${code} for order ${orderId}`,
        );
      } catch (err) {
        this.logger.warn(
          `[PaymentsService] Contract adapter payment recording failed (non-blocking): ${err}`,
        );
      }
    }

    return result;
  }

  async getRedemptionHistory(userId: string) {
    return this.databaseService.getRedemptionsByUser(userId);
  }

  async getAllCoupons() {
    return this.databaseService.getAllCoupons();
  }
}
