import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StrLey } from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';

export interface WalletOperation {
  id: string;
  type: string;
  createdAt: string;
  sourceAccount: string;
  transactionHash: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  from?: string;
  to: string;
  memo?: string;
}

type HorizonErrorMetadata = {
  status?: number;
  code?: string;
  message?: string;
  x?: unknown;
};

@Injectable()
export class HorizonService {
  private readonly logger = new Logger(HorizonService.name);

  constructor(private readonly stellar: StellarService) {}

  async getAccount(publicKey: string) {
    this.assertPublicKey(publicKey);
    try {
      const account = await this.stellar.server.loadAccount(publicKey);
      return {
        accountId: account.accountId(),
        sequence: account.sequence,
        balances: account.balances.map((balance) => ({
          assetCode: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
          assetIssuer: balance.asset_type === 'native' ? undefined : balance.asset_issuer,
          amount: balance.balance,
        })),
      };
    } catch (error) {
      const metadata = this.extractHorizonErrorMetadata(error);
      this.logHorizonFailure('getAccount', publicKey, metadata, error);
      if (metadata.status === 404) {
        throw new NotFoundException('Stellar account not found');
      }
      throw new ServiceUnavailableException('Unable to fetch Stellar account');
    }
  }

  async getHistory(publicKey: string, limit = 20, cursor?: string) {
    this.assertPublicKey(publicKey);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    try {
      let request = this.stellar.server.operations().forAccount(publicKey).order('desc').limit(safeLimit);
      if (cursor) request = request.cursor(cursor);
      const page = await request.call();
      const operations = (page.records as unknown as Array<Record<string, unknown>>).map((record) =>
        this.normalizeOperation(record),
      );
      return {
        accountId: publicKey,
        operations,
        nextCursor: page.records.length === safeLimit
          ? String(page.records[page.records.length - 1].paging_token ?? operations[operations.length - 1].id)
          : null,
      };
    } catch (error) {
      const metadata = this.extractHorizonErrorMetadata(error);
      this.logHorizonFailure('getHistory', publicKey, metadata, error);
      throw new ServiceUnavailableException('Unable to fetch Stellar transaction history');
    }
  }

  private assertPublicKey(publicKey: string): void {
    if (!StrLey.isValidEd25519PublicKey(publicKey)) {
      throw new BadRequestException('Invalid Stellar account ID');
    }
  }

  private extractHorizonErrorMetadata(error: unknown): HorizonErrorMetadata {
    if (!error || typeof error !== 'object') {
      return {};
    }
    const candidate = error as {
      response?: { status?: number; data?: unknown };
      status?: number;
      code?: string;
      message?: string;
    };
    const data = candidate.response?.data as Record<string, unknown> | undefined;
    const metadata: HorizonErrorMetadata = {
      status: candidate.response?.status ?? candidate.status,
      code: typeof data?.code === 'string' ? data.code : candidate.code,
      message: typeof data?.message === 'string' ? data.message : candidate.message,
      x: data?.x,
    };
    return metadata;
  }

  private logHorizonFailure(
    operation: string,
    publicKey: string,
    metadata: HorizonErrorMetadata,
    error: unknown,
  ): void {
    const details = {
      operation,
      accountId: publicKey,
      status: metadata.status,
      code: metadata.code,
      message: metadata.message,
      x: metadata.x,
    };
    this.logger.warn(`Horizon request failed: ${JSON.stringify(details)}`, error instanceof Error ? error.stack : undefined);
  }

  private normalizeOperation(record: Record<string, unknown>): WalletOperation {
    const transaction = record.transaction as Record<string, unknown> | undefined;
    return {
      id: String(record.id),
      type: String(record.type),
      createdAt: String(record.created_at),
      sourceAccount: String(record.source_account),
      transactionHash: String(record.transaction_hash ?? transaction?.hash ?? ''),
      amount: record.amount == null ? undefined : String(record.amount),
      assetCode: record.asset_type === 'native' ? 'XLM' : record.asset_code as string | undefined,
      assetIssuer: record.asset_issuer as string | undefined,
      from: record.from as string | undefined,
      to: record.to as string | undefined,
      memo: transaction?.memo as string | undefined,
    };
  }
}
