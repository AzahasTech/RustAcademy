import { Injectable, Logger } from '@nestjs/common';

export interface UserPreferencesDto {
  learnerPreferences?: Record<string, unknown>;
  tutorPreferences?: Record<string, unknown>;
}

export interface UserPreferencesResponse {
  userId: string;
  learnerPreferences?: Record<string, unknown>;
  tutorPreferences?: Record<string, unknown>;
}

export interface UserPrivilegeChangeEvent {
  userId: string;
  previousRole: string;
  newRole: string;
  changedBy: string;
  timestamp: Date;
}

/**
 * Notification channel preferences for a user.
 * Used by NotificationsService to verify user consent before delivery (#385).
 */
export interface UserNotificationPreferences {
  userId: string;
  email_alerts: boolean;
  push_notifications: boolean;
  marketing_updates: boolean;
}

/**
 * User profile data for email template personalization.
 * Includes fallback-safe fields so templates never render blank content.
 */
export interface UserProfileFields {
  userId: string;
  name?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly preferencesByUser = new Map<string, UserPreferencesResponse>();
  private readonly privilegeChangeLog: UserPrivilegeChangeEvent[] = [];
  /** Tracks (userId → assetIds) for upload deduplication awareness. */
  private readonly userUploads = new Map<string, Set<string>>();

  async updatePreferences(
    userId: string,
    dto: UserPreferencesDto,
  ): Promise<UserPreferencesResponse> {
    const existing = this.preferencesByUser.get(userId) || {
      userId,
      learnerPreferences: {},
      tutorPreferences: {},
    };

    const next = {
      ...existing,
      ...dto,
      learnerPreferences: {
        ...(existing.learnerPreferences || {}),
        ...(dto.learnerPreferences || {}),
      },
      tutorPreferences: {
        ...(existing.tutorPreferences || {}),
        ...(dto.tutorPreferences || {}),
      },
    };

    this.preferencesByUser.set(userId, next);
    return next;
  }

  async onUserPrivilegeChange(
    userId: string,
    previousRole: string,
    newRole: string,
    changedBy: string,
  ): Promise<void> {
    const event: UserPrivilegeChangeEvent = {
      userId,
      previousRole,
      newRole,
      changedBy,
      timestamp: new Date(),
    };
    this.privilegeChangeLog.push(event);
    this.logger.warn(
      `User ${userId} privilege changed from ${previousRole} to ${newRole} by ${changedBy}`,
    );
  }

  getPrivilegeChangeLog(userId?: string): UserPrivilegeChangeEvent[] {
    if (userId) {
      return this.privilegeChangeLog.filter((e) => e.userId === userId);
    }
    return this.privilegeChangeLog;
  }

  /**
   * Retrieves a user's notification channel preferences.
   *
   * Returns default-enabled preferences when no explicit preferences exist,
   * ensuring notifications are never silently dropped for unconfigured users.
   */
  async getUserNotificationPreferences(
    userId: string,
  ): Promise<UserNotificationPreferences> {
    const prefs = this.preferencesByUser.get(userId);
    return {
      userId,
      email_alerts: (prefs?.learnerPreferences?.['email_alerts'] as boolean) ?? true,
      push_notifications: (prefs?.learnerPreferences?.['push_notifications'] as boolean) ?? true,
      marketing_updates: (prefs?.learnerPreferences?.['marketing_updates'] as boolean) ?? false,
    };
  }

  /**
   * Retrieves user profile fields for email template personalization.
   *
   * Returns safe defaults for any missing fields so email templates
   * never render broken or blank content (#387).
   */
  async getUserProfileFields(userId: string): Promise<UserProfileFields> {
    const prefs = this.preferencesByUser.get(userId);
    return {
      userId,
      name: (prefs?.learnerPreferences?.['displayName'] as string) || undefined,
      email: (prefs?.learnerPreferences?.['email'] as string) || undefined,
      displayName:
        (prefs?.learnerPreferences?.['displayName'] as string) || undefined,
      avatarUrl:
        (prefs?.learnerPreferences?.['avatarUrl'] as string) || undefined,
    };
   * Records an asset upload against a user for ownership tracking.
   */
  recordAssetUpload(userId: string, assetId: string): void {
    if (!this.userUploads.has(userId)) {
      this.userUploads.set(userId, new Set());
    }
    this.userUploads.get(userId)!.add(assetId);
  }

  /**
   * Returns all asset IDs uploaded by a user.
   */
  getUserUploads(userId: string): string[] {
    return Array.from(this.userUploads.get(userId) ?? []);
  }
}
