import { Injectable } from '@nestjs/common';
import { SubmissionsService, ReviewQueueMetrics, FlaggedSubmission } from '../submissions/submissions.service';

export interface AdminDashboardSummary {
  totalUsers: number;
  activeTutors: number;
  totalCourses: number;
  completionRate: number;
}

export interface ReviewQueueDashboard {
  summary: AdminDashboardSummary;
  reviewQueue: ReviewQueueMetrics;
  recentFlags: FlaggedSubmission[];
}

@Injectable()
export class AdminService {
  constructor(private readonly submissionsService: SubmissionsService) {}

  async getDashboardSummary(): Promise<AdminDashboardSummary> {
    return {
      totalUsers: 128,
      activeTutors: 24,
      totalCourses: 41,
      completionRate: 0.67,
    };
  }

  async getReviewQueueDashboard(): Promise<ReviewQueueDashboard> {
    const summary = await this.getDashboardSummary();
    const reviewQueue = this.submissionsService.getQueueMetrics();
    const recentFlags = this.submissionsService.getFlaggedSubmissions().slice(-10);
    return { summary, reviewQueue, recentFlags };
  }

  async assignModerator(flagId: string, moderatorId: string): Promise<FlaggedSubmission> {
    return this.submissionsService.assignReviewer(flagId, moderatorId);
  }

  async getFlaggedSubmissions(status?: string): Promise<FlaggedSubmission[]> {
    return this.submissionsService.getFlaggedSubmissions(status as any);
  }

  async getReviewQueueMetrics(): Promise<ReviewQueueMetrics> {
    return this.submissionsService.getQueueMetrics();
  }

  async dismissFlag(flagId: string, dismissedBy: string): Promise<FlaggedSubmission> {
    return this.submissionsService.dismissFlag(flagId, dismissedBy);
  }
}