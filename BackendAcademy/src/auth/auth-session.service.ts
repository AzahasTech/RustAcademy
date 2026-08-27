import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditLogService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import { UserRole } from './enums/user-role.enum';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import {
  AuthTokensResponse,
  RefreshTokenPayload,
  Session,
} from './interfaces/session.interface';
import { Redis } from 'ioredis';

export interface SessionPolicy {
  accessTokenTtl: number;
  refreshTokenTtl: number;
  deliveryGracePeriod: number;
  maxConcurrentSessions: number;
  singleSessionMode: boolean;
  requireDeviceFingerprint: boolean;
  idleSessionTimeout: number;
}

const DEFAULT_SESSION_POLICY: SessionPolicy = {
  accessTokenTtl: 900,
  refreshTokenTtl: 604_800,
  deliveryGracePeriod: 300,
  maxConcurrentSessions: 5,
  singleSessionMode: false,
  requireDeviceFingerprint: false,
  idleSessionTimeout: 86_400,
};

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private readonly sessionPolicy: SessionPolicy;
  private readonly refreshLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.sessionPolicy = {
      accessTokenTtl: this.configService.get<number>('SESSION_ACCESS_TOKEN_TTL', DEFAULT_SESSION_POLICY.accessTokenTtl),
      refreshTokenTtl: this.configService.get<number>('SESSION_REFRESH_TOKEN_TTL', DEFAULT_SESSION_POLICY.refreshTokenTtl),
      deliveryGracePeriod: this.configService.get<number>('SESSION_DELIVERY_GRACE_PERIOD', DEFAULT_SESSION_POLICY.deliveryGracePeriod),
      maxConcurrentSessions: this.configService.get<number>('SESSION_MAX_CONCURRENT', DEFAULT_SESSION_POLICY.maxConcurrentSessions),
      singleSessionMode: this.configService.get<boolean>('SESSION_SINGLE_MODE', DEFAULT_SESSION_POLICY.singleSessionMode),
      requireDeviceFingerprint: this.configService.get<boolean>('SESSION_REQUIRE_DEVICE', DEFAULT_SESSION_POLICY.requireDeviceFingerprint),
      idleSessionTimeout: this.configService.get<number>('SESSION_IDLE_TIMEOUT', DEFAULT_SESSION_POLICY.idleSessionTimeout),
    };
  }

  getSessionPolicy(): Readonly<SessionPolicy> {
    return { ...this.sessionPolicy };
  }

  async createSession(
    userId: string,
    role: UserRole,
    deviceFingerprint?: string,
  ): Promise<AuthTokensResponse> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionPolicy.refreshTokenTtl * 1000);
    const { accessToken, refreshToken } = await this.signTokenPair(userId, role, sessionId);
    const deviceHash = deviceFingerprint ? this.hashDevice(deviceFingerprint) : undefined;

    if (this.sessionPolicy.singleSessionMode) {
      await this.revokeAllUserSessions(userId);
    }

    const activeSessions = await this.getActiveSessions(userId);
    if (activeSessions.length >= this.sessionPolicy.maxConcurrentSessions) {
      const oldest = activeSessions.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];
      if (oldest) {
        await this.revokeSession(oldest.sessionId);
        this.logger.warn(
          `Revoked oldest session ${oldest.sessionId} for user ${userId} (max concurrent: ${this.sessionPolicy.maxConcurrentSessions})`,
        );
      }
    }

    const session: Session = {
      sessionId,
      userId,
      role,
      refreshTokenHash: this.hashToken(refreshToken),
      createdAt: now,
      expiresAt,
      revoked: false,
      deviceHash,
      isTrustedDevice: deviceHash
        ? await this.isTrustedDevice(userId, deviceHash)
        : undefined,
    };

    await this.setSession(session);
    if (deviceHash && !(await this.isTrustedDevice(userId, deviceHash))) {
      this.logger.warn(`New device login for user ${userId}`);
    }

    this.auditService.create({ action: 'login', actor: userId, outcome: 'SUCCESS', session: sessionId, requestContext: { deviceHash } });
    return this.buildTokensResponse(accessToken, refreshToken);
  }

  async refreshTokens(rawRefreshToken: string): Promise<AuthTokensResponse> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        rawRefreshToken,
        { secret: this.refreshSecret },
      );
    } catch {
      throw new UnauthorizedException({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or has expired',
      });
    }

    return this.withRefreshLock(payload.sessionId, async () => {
      const claimKey = `refreshClaim:${payload.sessionId}`;
      const claimed = await this.redis.set(claimKey, randomUUID(), 'EX', 30, 'NX');
      if (claimed !== 'OK') {
        throw new UnauthorizedException({
          error: 'SESSION_NOT_FOUND',
          message: 'Session has been revoked or does not exist',
        });
      }

      const session = await this.getSession(payload.sessionId);
      if (!session || session.revoked) {
        await this.redis.del(claimKey);
        throw new UnauthorizedException({
          error: 'SESSION_NOT_FOUND',
          message: 'Session has been revoked or does not exist',
        });
      }

      if (this.hashToken(rawRefreshToken) !== session.refreshTokenHash) {
        session.revoked = true;
        await this.setSession(session);
        await this.redis.del(claimKey);
        throw new UnauthorizedException({
          error: 'TOKEN_REUSE_DETECTED',
          message: 'Refresh token has already been used; session revoked',
        });
      }

      if (new Date() > new Date(session.expiresAt.getTime() + this.sessionPolicy.deliveryGracePeriod * 1000)) {
        session.revoked = true;
        await this.setSession(session);
        await this.redis.del(claimKey);
        throw new UnauthorizedException({
          error: 'SESSION_EXPIRED',
          message: 'Session has expired; please log in again',
        });
      }

      // This write is inside the per-session lock, so only one concurrent
      // request can observe and consume the valid refresh token.
      session.revoked = true;
      await this.setSession(session);
      await this.redis.del(claimKey);
      return this.createSession(session.userId, session.role);
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      session.revoked = true;
      await this.setSession(session);
      this.logger.log(`Session ${sessionId} revoked for user ${session.userId}`);
      this.auditService.create({ action: 'logout', actor: session.userId, outcome: 'SUCCESS', session: sessionId });
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(this.userSessionsKey(userId));
    let count = 0;
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && !session.revoked) {
        session.revoked = true;
        await this.setSession(session);
        count++;
      }
    }
    this.logger.log(`All ${count} sessions revoked for user ${userId}`);
  }

  async getActiveSessions(userId: string): Promise<Omit<Session, 'refreshTokenHash'>[]> {
    const sessionIds = await this.redis.smembers(this.userSessionsKey(userId));
    const now = new Date();
    const result: Omit<Session, 'refreshTokenHash'>[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.userId === userId && !session.revoked && session.expiresAt > now) {
        const { refreshTokenHash: _hash, ...rest } = session;
        result.push(rest);
      }
    }
    return result;
  }

  hashDevice(fingerprint: string): string {
    return createHash('sha256').update(fingerprint).digest('hex');
  }

  async isTrustedDevice(userId: string, deviceHash: string): Promise<boolean> {
    const devices = await this.redis.smembers(`trustedDevices:${userId}`);
    return devices.includes(deviceHash);
  }

  async addTrustedDevice(userId: string, deviceHash: string): Promise<void> {
    await this.redis.sadd(`trustedDevices:${userId}`, deviceHash);
  }

  async removeTrustedDevice(userId: string, deviceHash: string): Promise<void> {
    await this.redis.srem(`trustedDevices:${userId}`, deviceHash);
  }

  async getTrustedDevices(userId: string): Promise<string[]> {
    return this.redis.smembers(`trustedDevices:${userId}`);
  }

  async checkDeviceTrust(userId: string, deviceFingerprint: string): Promise<{ trusted: boolean; deviceHash: string }> {
    const deviceHash = this.hashDevice(deviceFingerprint);
    return { trusted: await this.isTrustedDevice(userId, deviceHash), deviceHash };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async withRefreshLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.refreshLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.refreshLocks.set(sessionId, queued);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.refreshLocks.get(sessionId) === queued) {
        this.refreshLocks.delete(sessionId);
      }
    }
  }

  private sessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private userSessionsKey(userId: string): string {
    return `userSessions:${userId}`;
  }

  private async getSession(sessionId: string): Promise<Session | null> {
    const data = await this.redis.get(this.sessionKey(sessionId));
    if (!data) return null;
    const session = JSON.parse(data) as Session;
    return {
      ...session,
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt),
    };
  }

  private async setSession(session: Session): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000) + this.sessionPolicy.deliveryGracePeriod,
    );
    await this.redis.set(this.sessionKey(session.sessionId), JSON.stringify(session), 'EX', ttlSeconds);
    await this.redis.sadd(this.userSessionsKey(session.userId), session.sessionId);
  }

  private get refreshSecret(): string {
    return this.configService.get<string>('JWT_REFRESH_SECRET', 'change-me');
  }

  private async signTokenPair(
    userId: string,
    role: UserRole,
    sessionId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: JwtPayload = { sub: userId, role };
    const refreshPayload: RefreshTokenPayload = { sub: userId, role, sessionId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        expiresIn: this.sessionPolicy.accessTokenTtl,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: this.sessionPolicy.refreshTokenTtl,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private buildTokensResponse(accessToken: string, refreshToken: string): AuthTokensResponse {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.sessionPolicy.accessTokenTtl,
    };
  }
}
