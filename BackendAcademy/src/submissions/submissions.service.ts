import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ChallengesService } from '../challenges/challenges.service';
import { MonitoringService } from '../monitoring/monitoring.service';

@Injectable()
export class SubmissionsService {
  private readonly submissions: Array<{
    id: string;
    learnerId: string;
    taskId: string;
    content: string;
  }> = [];

  constructor(
    private readonly challengesService: ChallengesService,
    private readonly monitoringService: MonitoringService,
  ) {}

  findAll(): string[] {
    return this.submissions.map((submission) => submission.id);
  }

  findOne(id: string): string {
    const submission = this.submissions.find((item) => item.id === id);
    return submission ? JSON.stringify(submission) : 'Submission not found';
  }

  create(payload: { learnerId: string; taskId: string; content: string }): string {
    // Check whether the target task is a challenge and enforce the attempt
    // limit before accepting the submission.
    const { learnerId, taskId, content } = payload;

    this.verifyChallengeAttemptLimit(taskId, learnerId);

    const submission = {
      id: `${Date.now()}`,
      learnerId,
      taskId,
      content,
    };

    this.submissions.push(submission);

    // Record the attempt when the submission targets a challenge.
    this.recordChallengeAttempt(taskId, learnerId);

    this.monitoringService.recordDomainEvent('submission_created', 'submissions');
    return JSON.stringify(submission);
  }

  /**
   * Check whether the given task is a known challenge. If so, verify that
   * the learner has not exhausted their allowed attempts.
   *
   * This method treats any taskId that starts with "challenge-" as a challenge
   * task, which aligns with the convention used in the `ChallengesService`.
   *
   * @throws BadRequestException when the attempt limit has been exceeded.
   */
  private verifyChallengeAttemptLimit(taskId: string, learnerId: string): void {
    if (!this.isChallengeTask(taskId)) return;

    const info = this.challengesService.checkAttemptLimit(taskId, learnerId);
    if (!info.allowed) {
      this.monitoringService.recordDomainEvent(
        'attempt_limit_exceeded',
        'submissions',
      );
      throw new BadRequestException({
        error: 'ATTEMPT_LIMIT_EXCEEDED',
        message: `Maximum attempts (${info.max}) exhausted for challenge "${info.challengeId}"`,
        ...info,
      });
    }
  }

  /**
   * Record an attempt for the learner on the challenge task, if applicable.
   *
   * This is called after `verifyChallengeAttemptLimit` has already confirmed
   * the user is within their allowed limit, so `recordAttempt` is guaranteed
   * to succeed. No try/catch is needed.
   */
  private recordChallengeAttempt(taskId: string, learnerId: string): void {
    if (!this.isChallengeTask(taskId)) return;

    this.challengesService.recordAttempt(taskId, learnerId);
    this.monitoringService.recordDomainEvent('challenge_attempt_recorded', 'submissions');
  }

  /**
   * Decide whether a taskId references a challenge.
   *
   * This heuristic checks for the `challenge-` prefix convention.
   *
   * @todo Replace this heuristic with a proper challenge→task lookup when a
   *       challenge entity or registry is available (e.g. a database table
   *       that maps challenge IDs to task IDs).
   */
  private isChallengeTask(taskId: string): boolean {
    return taskId?.toLowerCase().startsWith('challenge-');
  }
}
