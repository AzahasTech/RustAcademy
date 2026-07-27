import { Injectable } from '@nestjs/common';
import { ReportsService, ReportStatus, ReportTriageEntry } from '../reports/reports.service';

export interface AdminDashboardSummary {
  totalUsers: number;
  activeTutors: number;
  totalCourses: number;
  completionRate: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly reportsService: ReportsService) {}

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
  }
}
