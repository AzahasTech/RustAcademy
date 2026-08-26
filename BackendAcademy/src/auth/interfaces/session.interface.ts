import { UserRole } from '../enums/user-role.enum';

/**
 * Represents a stored session record, persisted in a durable shared backend
 * (e.g., Redis or a database) so sessions survive restarts and are visible
 * across all replicas.
 */
export interface Session {
  /** Unique session identifier (also stored inside the refresh token payload). */
  sessionId: string;

  /** Owner of the session. */
  userId: string;

  /** Role associated with the session. */
  role: UserRole;

  /** SHA-256 hash of the refresh token (never store raw token). */
  refreshTokenHash: string;

  /** When this session was first created. */
  createdAt: Date;

  /** When the refresh token expires. */
  expiresAt: Date;

  /** Flag set to true once the session is revoked (logout / rotation). */
  revoked: boolean;

  /** SHA-256 hash of the device fingerprint (if device binding is enabled). */
  deviceHash?: string;

  /** Whether the device has been previously trusted by this user. */
  isTrustedDevice?: boolean;
}

/**
 * Payload embedded in a signed refresh JWT.
 */
export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

/**
 * Returned to the caller after a successful login or token refresh.
 */
export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access token TTl in seconds. */
  expiresIn: number;
}
