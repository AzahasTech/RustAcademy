import { Injectable } from '@nestjs/common';
import { ReportsService, ReportStatus, ReportTriageEntry } from '../reports/reports.service';
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
  constructor(private readonly reportsService: ReportsService) {}
  constructor(private readonly socialService: SocialService) {}

  async getDashboardSummary(): Promise<AdminDashboardSummary> {
    return {
      totalUsers: 128,
      activeTutors: 24,
      totalCourses: 41,
      completionRate: 0.67,
    };
  }

  getPendingReports(): ReportTriageEntry[] {
    return this.reportsService.getAllReports('submitted');
  }

  getReportsInTriage(): ReportTriageEntry[] {
    return this.reportsService.getAllReports('triage');
  }

  assignReport(reportId: string, adminId: string): ReportTriageEntry {
    const report = this.reportsService.transitionReportStatus(reportId, adminId, 'triage', `Assigned to ${adminId}`);
    report.assignedTo = adminId;
    return report;
  }

  escalateReport(reportId: string, adminId: string, note: string): ReportTriageEntry {
    return this.reportsService.transitionReportStatus(reportId, adminId, 'escalated', note);
  }

  resolveReport(reportId: string, adminId: string, note: string): ReportTriageEntry {
    return this.reportsService.transitionReportStatus(reportId, adminId, 'resolved', note);
  }

  dismissReport(reportId: string, adminId: string, note: string): ReportTriageEntry {
    return this.reportsService.transitionReportStatus(reportId, adminId, 'dismissed', note);
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
