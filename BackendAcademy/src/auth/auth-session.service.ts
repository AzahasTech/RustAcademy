### BackendAcademy/src/auth/auth-session.service.ts

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

  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly auditService: AuditLogService;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    private readonly auditService: AuditLogService,
  ) {
    this.redis = redisClient;
    // #350: Load centralized session policy from config
    this.sessionPolicy = {
      accessTokenTtl: this.configService.get<number>('SESSION_ACCESS_TOKEN_TTL', DEFAULT_SESSION_POLICY.accessTokenTtl),
      refreshTokenTtl: this.configService.get<number>('SESSION_REFRESH_TOKEN_TTL', DEFAULT_SESSION_POLICY.refreshTokenTtl),
      deliveryGracePeriod: this.configService.get<number>('SESSION_DELIVERY_GRACE_PERIOD', DEFAULT_SESSION_POLICY.deliveryGracePeriod),
      maxConcurrentSessions: this.configService.get<number>('SESSION_MAX_CONCURRENT', DEFAULT_SESSION_POLICY.maxConcurrentSessions),
      singleSessionMode: this.configService.get<boolean>('SESSION_SINGLE_MODE', DEFAULT_SESSION_POLICY.singleSessionMode),
      requireDeviceFingerprint: this.configService.get<boolean>('SESSION_REQUIRE_DEVICE', DEFAULT_SESSION_POLICY.requireDeviceFingerprint),
      idleSessionTimeout: this.configService.get<number>('SESSION_IDLE_TIMEOUT', DEFAULT_SESSION_POLICY.idleSessionTimeout),
    };

    this.accessSecret = this.configService.get<string=('JWT_ACCESS_SECRET', 'default-access-secret');
    this.refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET', 'default-refresh-secret');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // --------------------------------------------------------------------------------------------
  // #350: Public policy access
  // -------------------------------------------------------------------------------------------

  /**
   * Returns the current session policy for external consumers.
   */
  getSessionPolicy(): Readonly<SessionPolicy> {
    return { ...this.sessionPolicy };
  }

  // --------------------------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------------------------

  /**
   * Creates a new session for the given user.
   * Optionally records a device fingerprint for trusted-device recognition.
   */
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

    const session: Session & { lastUsedAt: Date } = {
      sessionId,
      userId,
      role,
      refreshTokenHash: this.hashToken(refreshToken),
      refreshTokenThash: this.hashToken(refreshToken),
      createdAt: now,
      expiresAt,
      revoked: false,
      deviceHash,
      isTrustedDevice: deviceHash
        ? await this.isTrustedDevice(userId, deviceHash)
        : undefined,
      lastUsedAt: now,
    };

    await this.setSession(session);
    if (deviceHash) await this.redis.sadd(`trustedDevices:${userId}`, deviceHash);

    if (deviceHash && !(await this.isTrustedDevice(userId, deviceHash))) {
      this.logger.warn(`New device login for user ${userId}`);
    }

    await this.auditService.create({ action: 'login', actor: userId, outcome: 'SUCCESS', session: sessionId, requestContext: { deviceHash } });
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
    if (this.hashToken(rawRefreshToken) !== session.refreshTokenHash) {
      // Token reuse detected - revoke the whole session as a security measure.
      session.revoked = true;
      await this.setSession(session);
      throw new UnauthorizedException({
        error: 'TOKEN_REUSE_DETECTED',
        message: 'Refresh token has already been used; session revoked',
      });
    }

    const now = new Date();
    // Enforce absolute expiry (including delivery grace) before relying on JWT expiry.
    if (this.isSessionExpired(session, now)) {
      session.revoked = true;
      await this.setSession(session);
      throw new UnauthorizedException({
        error: 'SESSION_EXPIRED',
        message: 'Session has expired; please log in again',
      });
    }

    // Enforce idle timeout independently of token validity.
    if (this.isSessionIdle(session, now)) {
      session.revoked = true;
      await this.setSession(session);
      throw new UnauthorizedException({
        error: 'SESSION_IDLE_TIMEOUT',
        message: 'Session has been idle for too long; please log in again',
      });
    }

    // Revoke the old session before issuing new tokens (rotation).
    session.revoked = true;
    await this.setSession(session);

    await this.auditService.create({ action: 'refresh', actor: session.userId, outcome: 'SUCCESS', session: session.sessionId });
    return await this.createSession(session.userId, session.role);
  }

  async revokeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      session.revoked = true;
      await this.setSession(session);
      this.logger.log(`Session ${sessionId} revoked for user ${session.userId}`);
      await this.auditService.create({ action: 'logout', actor: session.userId, outcome: 'SUCCESS', session: sessionId });
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(this.userSessionsKey(userId));
    const sessionIds = await this.redis.smembers(`userSessions:${userId}`);
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
    await this.auditService.create({ action: 'logout_all', actor: userId, outcome: 'SUCCESS', requestContext: { count } });
  }

  /**
   * Returns all active (non-revoked, non-expired, not idle) sessions for a user.
   */
  async getActiveSessions(userId: string): Promise<Omit<Session, 'refreshToken'>[]> {
    const sessionIds = await this.redis.smembers(`userSessions:${userId}`);
    const now = new Date();
    const result: Omit<Session, 'refreshTokenHash'>[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.userId === userId && !session.revoked && session.expiresAt > now) {
        const { refreshTokenHash: _hash, ...rest } = session;
      if (session && !session.revoked && !this.isSessionExpired(session, now) && !this.isSessionIdle(session, now)) {
        const { refreshToken, ...rest } = session;
        result.push(rest);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Device binding & trusted device recognition
  // --------------------------------------------------------------------------------------------

  hashDevice(fingerprint: string): string {
    return createHash('sha256').update(fingerprint).digest('hex');
  }

  async isTrustedDevice(userId: string, deviceHash: string): Promise<boolean> {
    const devices = await this.redis.smembers(`trustedDevices:${userId}`);
    return devices.includes(deviceHash);
  }

  async addTrustedDevice(userId: string, deviceHash: string): Promise<void> {
    await this.redis.sadd(`trustedDevices:${userId}`, deviceHash);
    await this.auditService.create({ action: 'add_trusted_device', actor: userId, outcome: 'SUCCESS', requestContext: { deviceHash } });
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
    await this.auditService.create({ action: 'remove_trusted_device', actor: userId, outcome: 'SUCCESS', requestContext: { deviceHash } });
  }

  // --------------------------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------------------------

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
    const accessPayload: JwtPayload = { sub: userId, role, sessionId, type: 'access' };
    const refreshPayload: RefreshTokenPayload = { sub: userId, role, sessionId, type: 'refresh' };

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.accessSecret,
      expiresIn: this.sessionPolicy.accessTokenTtl,
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.refreshSecret,
      expiresIn: this.sessionPolicy.refreshTokenTtl,
    });

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
    return { accessToken, refreshToken };
  }

  private async setSession(session: Session & { lastUsedAt?: Date }): Promise<void> {
    const key = `session:${session.sessionId}`;
    // Store with TTL long enough to cover expiry +grace+buffer.
    const ttlSeconds = this.sessionPolicy.refreshTokenTtl + this.sessionPolicy.deliveryGracePeriod + 10; // +10s buffer offset
    await this.redis.set(key, JSON.stringify(session), 'EX', ttlSeconds);
    // Add to user's session set if not already there.
    await this.redis.sadd(`userSessions:${session.userId}`, session.sessionId);
  }

  private async getSession(sessionId: string): Promise<(Session & { lastUsedAt?: Date }) | null> {
    const key = `session:${sessionId}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as Session & { lastUsedAt?: Date };
  }

  private isSessionExpired(session: Session, now: Date): boolean {
    const expiryWithGrace = new Date(new Date(session.expiresAt).getTime() + this.sessionPolicy.deliveryGracePeriod * 1000);
    return now > expiryWithGrace;
  }

  private isSessionIdle(session: Session & { lastUsedAt?: Date }, now: Date): boolean {
    const lastUsedAt = session.lastUsedAt ? new Date(session.lastUsedAt) : new Date(session.createdAt);
    return now.getTime() - lastUsedAt.getTime() > this.sessionPolicy.idleSessionTimeout * 1000;
  }
}
