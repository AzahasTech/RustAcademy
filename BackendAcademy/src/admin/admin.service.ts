import { Injectable } from '@nestjs/common';
import { SocialService, SocialPost, ModerationStatus } from '../social/social.service';

export interface AdminDashboardSummary {
  totalUsers: number;
  activeTutors: number;
  totalCourses: number;
  completionRate: number;
}

export interface ModerationQueueSummary {
  pending: number;
  flagged: number;
  total: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly socialService: SocialService) {}

  async getDashboardSummary(): Promise<AdminDashboardSummary> {
    return {
      totalUsers: 128,
      activeTutors: 24,
      totalCourses: 41,
      completionRate: 0.67,
    };
  }

  getModerationQueueSummary(): ModerationQueueSummary {
    const queue = this.socialService.getModerationQueue();
    const pending = queue.filter((p) => p.moderationStatus === 'pending').length;
    const flagged = queue.filter((p) => p.moderationStatus === 'flagged').length;
    return { pending, flagged, total: queue.length };
  }

  getPendingContent(): SocialPost[] {
    return this.socialService.getPendingPosts();
  }

  getFlaggedContent(): SocialPost[] {
    return this.socialService.getFlaggedPosts();
  }

  moderatePost(postId: string, moderatorId: string, status: ModerationStatus, reason?: string): SocialPost {
    return this.socialService.moderatePost(postId, moderatorId, { status, reason });
  }

  bulkModerate(moderatorId: string, actions: Array<{ postId: string; status: ModerationStatus; reason?: string }>): number {
    return this.socialService.bulkModerate(moderatorId, actions);
  }
}
