import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

export enum ReviewQueueStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum FlagReason {
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  PLAGIARISM = 'plagiarism',
  OFF_TOPIC = 'off_topic',
  INCOMPLETE = 'incomplete',
  MANUAL_REVIEW_REQUESTED = 'manual_review_requested',
  OTHER = 'other',
}

export interface FlaggedSubmission {
  id: string;
  submissionId: string;
  flaggedBy: string;
  flagReason: FlagReason;
  comment: string;
  status: ReviewQueueStatus;
  assignedTo?: string;
  assignedAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewQueueMetrics {
  totalFlagged: number;
  pendingReview: number;
  assigned: number;
  underReview: number;
  resolved: number;
  dismissed: number;
}

@Injectable()
export class SubmissionsService {
  private readonly flagged: Map<string, FlaggedSubmission> = new Map();

  flagSubmission(
    submissionId: string,
    flaggedBy: string,
    flagReason: FlagReason,
    comment: string,
  ): FlaggedSubmission {
    const entry: FlaggedSubmission = {
      id: crypto.randomUUID(),
      submissionId,
      flaggedBy,
      flagReason,
      comment,
      status: ReviewQueueStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.flagged.set(entry.id, entry);
    return entry;
  }

  getFlaggedSubmissions(status?: ReviewQueueStatus): FlaggedSubmission[] {
    const all = Array.from(this.flagged.values());
    if (status) {
      return all.filter((f) => f.status === status);
    }
    return all;
  }

  getFlaggedSubmission(id: string): FlaggedSubmission | undefined {
    return this.flagged.get(id);
  }

  assignReviewer(flagId: string, reviewerId: string): FlaggedSubmission {
    const entry = this.flagged.get(flagId);
    if (!entry) throw new NotFoundException('Flagged submission not found');
    if (entry.status !== ReviewQueueStatus.PENDING) {
      throw new BadRequestException('Only pending flags can be assigned');
    }
    entry.assignedTo = reviewerId;
    entry.assignedAt = new Date();
    entry.status = ReviewQueueStatus.ASSIGNED;
    entry.updatedAt = new Date();
    return entry;
  }

  startReview(flagId: string, reviewerId: string): FlaggedSubmission {
    const entry = this.flagged.get(flagId);
    if (!entry) throw new NotFoundException('Flagged submission not found');
    if (entry.assignedTo !== reviewerId) {
      throw new BadRequestException('This flag is not assigned to you');
    }
    if (entry.status !== ReviewQueueStatus.ASSIGNED) {
      throw new BadRequestException('Flag must be assigned before review');
    }
    entry.status = ReviewQueueStatus.UNDER_REVIEW;
    entry.updatedAt = new Date();
    return entry;
  }

  resolveFlag(
    flagId: string,
    reviewerId: string,
    resolutionNote?: string,
  ): FlaggedSubmission {
    const entry = this.flagged.get(flagId);
    if (!entry) throw new NotFoundException('Flagged submission not found');
    if (entry.assignedTo !== reviewerId) {
      throw new BadRequestException('This flag is not assigned to you');
    }
    entry.status = ReviewQueueStatus.RESOLVED;
    entry.resolvedAt = new Date();
    entry.resolvedBy = reviewerId;
    entry.resolutionNote = resolutionNote;
    entry.updatedAt = new Date();
    return entry;
  }

  dismissFlag(flagId: string, dismissedBy: string): FlaggedSubmission {
    const entry = this.flagged.get(flagId);
    if (!entry) throw new NotFoundException('Flagged submission not found');
    entry.status = ReviewQueueStatus.DISMISSED;
    entry.resolvedAt = new Date();
    entry.resolvedBy = dismissedBy;
    entry.updatedAt = new Date();
    return entry;
  }

  getQueueMetrics(): ReviewQueueMetrics {
    const all = Array.from(this.flagged.values());
    return {
      totalFlagged: all.length,
      pendingReview: all.filter((f) => f.status === ReviewQueueStatus.PENDING).length,
      assigned: all.filter((f) => f.status === ReviewQueueStatus.ASSIGNED).length,
      underReview: all.filter((f) => f.status === ReviewQueueStatus.UNDER_REVIEW).length,
      resolved: all.filter((f) => f.status === ReviewQueueStatus.RESOLVED).length,
      dismissed: all.filter((f) => f.status === ReviewQueueStatus.DISMISSED).length,
    };
  }

  getFlagsByReviewer(reviewerId: string): FlaggedSubmission[] {
    return Array.from(this.flagged.values()).filter(
      (f) => f.assignedTo === reviewerId,
    );
  }

  getFlagsBySubmission(submissionId: string): FlaggedSubmission[] {
    return Array.from(this.flagged.values()).filter(
      (f) => f.submissionId === submissionId,
    );
  }
}