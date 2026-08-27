import { BadRequestException, Injectable } from '@nestjs/common';
import { RegisterWalletDto, VerifyTransactionDto } from './dto/verify-transaction.dto';
import {
  TransactionVerificationResult,
  WalletAccount,
  WalletBalance,
  WalletTransaction,
} from './interfaces/wallet.interface';

/**
 * Amount handling — Issue #657 (BA-089).
 *
 * All monetary amounts are represented as **integer minor units** so that
 * `parseFloat` / floating-point arithmetic can never introduce rounding
 * errors in transfers or fees.
 *
 * Precision rules:
 * - `AMOUNT_SCALE = 100_000` (1e-5), i.e. one minor unit = 0.00001. This
 *   matches the wallet's existing 5-decimal display precision (`toFixed(5)`)
 *   and the 0.00001 network fee used in `verifyTransaction`.
 * - Parsing (`parseMinorUnits`): accepts plain decimal strings; inputs with
 *   more than 5 fractional digits are rounded half-up at the 5th decimal.
 * - Formatting (`formatMinorUnits`): converts back to a fixed 5-decimal
 *   string using integer division, so balances never accumulate float error.
 * - All comparisons and arithmetic (balances, fees, totals) happen on
 *   integers; floating point is never used for money math.
 */
const AMOUNT_SCALE = 100_000;

/** Network fee charged per verified transaction (0.00001 XLM). */
const NETWORK_FEE_MINOR_UNITS = 1;

/**
 * Parses a decimal amount string into integer minor units.
 * Returns null when the input is not a valid non-negative decimal amount.
 */
function parseMinorUnits(amount: string): number | null {
  const normalized = String(amount ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const [whole, fraction = ''] = normalized.split('.');
  const padded = (fraction + '00000').slice(0, 5);
  const units = Number(whole) * AMOUNT_SCALE + Number(padded);

  // Round half-up when more than 5 fractional digits were supplied.
  const extra = fraction.slice(5);
  if (extra.length > 0 && Number(extra[0]) >= 5) {
    return units + 1;
  }
  return units;
}

/** Formats integer minor units as a fixed 5-decimal string (e.g. "1.23456"). */
function formatMinorUnits(units: number): string {
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / AMOUNT_SCALE);
  const fraction = abs % AMOUNT_SCALE;
  return `${sign}${whole}.${String(fraction).padStart(5, '0')}`;
}

export interface ReconciliationResult {
  walletAddress: string;
  expectedBalance: string;
  actualBalance: string;
  difference: string;
  reconciledAt: Date;
  status: 'matched' | 'drift_detected' | 'error';
}

export interface ReconciliationReport {
  totalWallets: number;
  matched: number;
  driftDetected: number;
  errors: number;
  results: ReconciliationResult[];
  generatedAt: Date;
}

@Injectable()
export class WalletService {
  private readonly wallets = new Map<string, WalletAccount>();
  private readonly transactions = new Map<string, WalletTransaction>();
  private readonly verificationResults = new Map<string, TransactionVerificationResult>();

  async registerWallet(dto: RegisterWalletDto): Promise<WalletAccount> {
    if (this.wallets.has(dto.address)) {
      throw new BadRequestException({
        error: 'WALLET_ALREADY_REGISTERED',
        message: `Wallet ${dto.address} is already registered`,
      });
    }

    const account: WalletAccount = {
      address: dto.address,
      balance: '0.00',
      assetCode: dto.assetCode,
      createdAt: new Date(),
    };

    this.wallets.set(dto.address, account);
    return account;
  }

  async verifyTransaction(
    dto: VerifyTransactionDto,
  ): Promise<TransactionVerificationResult> {
    this.validateStellarAddress(dto.sourceAccount);
    this.validateStellarAddress(dto.destinationAccount);

    if (dto.sourceAccount === dto.destinationAccount) {
      throw new BadRequestException({
        error: 'SAME_ACCOUNT_TRANSFER',
        message: 'Source and destination accounts cannot be the same',
      });
    }

    // Amount arithmetic happens exclusively in integer minor units (#657).
    const amountUnits = parseMinorUnits(dto.amount);
    if (amountUnits === null || amountUnits <= 0) {
      throw new BadRequestException({
        error: 'INVALID_AMOUNT',
        message: 'Transaction amount must be a positive number',
      });
    }

    const sourceWallet = this.wallets.get(dto.sourceAccount);
    const sourceBalanceUnits = parseMinorUnits(sourceWallet?.balance ?? '0') ?? 0;

    const totalRequiredUnits = amountUnits + NETWORK_FEE_MINOR_UNITS;

    let verified: boolean;
    let status: TransactionVerificationResult['status'];
    let message: string;

    if (!sourceWallet) {
      verified = false;
      status = 'rejected';
      message = `Source account ${dto.sourceAccount} is not registered`;
    } else if (sourceBalanceUnits < totalRequiredUnits) {
      verified = false;
      status = 'rejected';
      message = `Insufficient balance. Required: ${formatMinorUnits(
        totalRequiredUnits,
      )}, available: ${formatMinorUnits(sourceBalanceUnits)}`;
    } else if (amountUnits > 1000 * AMOUNT_SCALE) {
      verified = true;
      status = 'pending';
      message = `Transaction of ${formatMinorUnits(
        amountUnits,
      )} ${dto.assetCode} requires additional verification`;
    } else {
      verified = true;
      status = 'verified';
      message = 'Transaction verified successfully';

      sourceWallet.balance = formatMinorUnits(sourceBalanceUnits - totalRequiredUnits);
      const destWallet = this.wallets.get(dto.destinationAccount);
      if (destWallet) {
        const destBalanceUnits = parseMinorUnits(destWallet.balance) ?? 0;
        destWallet.balance = formatMinorUnits(destBalanceUnits + amountUnits);
      }
    }

    const result: TransactionVerificationResult = {
      transactionId: dto.transactionId,
      verified,
      status,
      message,
      verifiedAt: new Date(),
      details: {
        sourceBalance: formatMinorUnits(sourceBalanceUnits),
        destinationBalance: this.wallets.get(dto.destinationAccount)?.balance ?? '0.00',
        fee: formatMinorUnits(NETWORK_FEE_MINOR_UNITS),
        networkPassphrase: 'Test SDF Network ; September 2015',
      },
    };

    this.verificationResults.set(dto.transactionId, result);

    if (verified) {
      const walletTx: WalletTransaction = {
        transactionId: dto.transactionId,
        sourceAccount: dto.sourceAccount,
        destinationAccount: dto.destinationAccount,
        amount: dto.amount,
        assetCode: dto.assetCode,
        memo: dto.memo,
        hash: this.generateHash(),
        status: status === 'verified' ? 'completed' : 'pending',
        createdAt: new Date(),
        completedAt: status === 'verified' ? new Date() : undefined,
      };
      this.transactions.set(dto.transactionId, walletTx);
    }

    return result;
  }

  async getWallet(address: string): Promise<WalletAccount> {
    const wallet = this.wallets.get(address);
    if (!wallet) {
      throw new BadRequestException({
        error: 'WALLET_NOT_FOUND',
        message: `Wallet ${address} not found`,
      });
    }
    return wallet;
  }

  async getWalletBalance(address: string): Promise<WalletBalance> {
    const wallet = this.wallets.get(address);

    const balances: WalletBalance['balances'] = [];
    if (wallet) {
      balances.push({
        assetCode: wallet.assetCode,
        amount: wallet.balance,
      });
    }

    // Always include native XLM balance
    balances.push({
      assetCode: 'XLM',
      amount: wallet ? wallet.balance : '0.00',
      assetIssuer: 'native',
    });

    return {
      address,
      balances,
      lastUpdated: new Date(),
    };
  }

  async getTransactionHistory(address: string): Promise<WalletTransaction[]> {
    const txs: WalletTransaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.sourceAccount === address || tx.destinationAccount === address) {
        txs.push(tx);
      }
    }
    return txs.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getVerificationStatus(
    transactionId: string,
  ): Promise<TransactionVerificationResult | null> {
    return this.verificationResults.get(transactionId) ?? null;
  }

  async getAllWallets(): Promise<WalletAccount[]> {
    return Array.from(this.wallets.values());
  }

  private validateStellarAddress(address: string): void {
    if (!address || !address.trim()) {
      throw new BadRequestException({
        error: 'INVALID_ADDRESS',
        message: 'Stellar address is required',
      });
    }
    if (!address.startsWith('G') || address.length !== 56) {
      throw new BadRequestException({
        error: 'INVALID_ADDRESS',
        message: 'Address must be a valid Stellar public key starting with G',
      });
    }
  }

  async reconcileAllWallets(): Promise<ReconciliationReport> {
    const results: ReconciliationResult[] = [];
    const now = new Date();
    for (const [address, wallet] of this.wallets) {
      try {
        const externalBalance = await this.fetchExternalBalance(address);
        const currentBalance = wallet.balance;
        if (currentBalance !== externalBalance) {
          results.push({
            walletAddress: address,
            expectedBalance: externalBalance,
            actualBalance: currentBalance,
            difference: this.diffAsMinorUnits(externalBalance, currentBalance),
            reconciledAt: now,
            status: 'drift_detected',
          });
        } else {
          results.push({
            walletAddress: address,
            expectedBalance: currentBalance,
            actualBalance: currentBalance,
            difference: '0.00000',
            reconciledAt: now,
            status: 'matched',
          });
        }
      } catch {
        results.push({
          walletAddress: address,
          expectedBalance: '0.00000',
          actualBalance: wallet?.balance ?? '0.00000',
          difference: '0.00000',
          reconciledAt: now,
          status: 'error',
        });
      }
    }
    const matched = results.filter((r) => r.status === 'matched').length;
    const driftDetected = results.filter((r) => r.status === 'drift_detected').length;
    const errors = results.filter((r) => r.status === 'error').length;
    return { totalWallets: this.wallets.size, matched, driftDetected, errors, results, generatedAt: now };
  }

  async reconcileWallet(address: string): Promise<ReconciliationResult> {
    const wallet = this.wallets.get(address);
    if (!wallet) {
      throw new BadRequestException({ error: 'WALLET_NOT_FOUND', message: `Wallet ${address} not found` });
    }
    const externalBalance = await this.fetchExternalBalance(address);
    const currentBalance = wallet.balance;
    const now = new Date();
    if (currentBalance !== externalBalance) {
      wallet.balance = externalBalance;
      this.wallets.set(address, wallet);
      return {
        walletAddress: address,
        expectedBalance: externalBalance,
        actualBalance: currentBalance,
        difference: this.diffAsMinorUnits(externalBalance, currentBalance),
        reconciledAt: now,
        status: 'drift_detected',
      };
    }
    return {
      walletAddress: address,
      expectedBalance: currentBalance,
      actualBalance: currentBalance,
      difference: '0.00000',
      reconciledAt: now,
      status: 'matched',
    };
  }

  /** Difference between two decimal balance strings, in integer minor units (#657). */
  private diffAsMinorUnits(expected: string, actual: string): string {
    const expectedUnits = parseMinorUnits(expected) ?? 0;
    const actualUnits = parseMinorUnits(actual) ?? 0;
    return formatMinorUnits(expectedUnits - actualUnits);
  }

  private async fetchExternalBalance(address: string): Promise<string> {
    return this.wallets.get(address)?.balance ?? '0.00000';
  }

  private generateHash(): string {
    return Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }
}
