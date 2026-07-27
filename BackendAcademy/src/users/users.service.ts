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
