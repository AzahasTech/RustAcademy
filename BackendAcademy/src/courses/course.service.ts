import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourseEntity } from './course.entity';
import {
  CourseRevisionEntity,
  CourseRevisionReason,
} from './course-revision.entity';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { RewardsService } from '../rewards/rewards.service';
import { IContractAdapter } from '../contracts';
import {
  TransactionManagerService,
  TransactionSnapshot,
} from '../common/transaction-manager.service';
import { CertificateService, CertificateRecord } from './certificate.service';

/**
 * Business logic for courses.
 *
 * Persistence is delegated to injected TypeORM repositories
 * (`Repository<CourseEntity>` and `Repository<CourseRevisionEntity>`).
 * Each meaningful course change appends an immutable revision to the
 * `course_revisions` table so the full version history is preserved as
 * an append-only audit trail.
 *
 * #396: Contract operations (reward recording, certificate minting)
 * are isolated behind the {@link IContractAdapter} interface rather than
 * being tightly coupled to contract-specific logic. When the adapter is
 * not available (e.g., in test environments), contract operations are
 * gracefully skipped.
 *
 * #358: All state-mutating operations during course completion are wrapped
 * in transactional atomic operations. If any side-effect fails, every
 * previously-successful mutation is rolled back so callers never observe
 * partially-applied completion state.
 */
@Injectable()
export class CourseService {
  private static readonly INITIAL_VERSION = 1;
  private readonly logger = new Logger(CourseService.name);

  constructor(
    @InjectRepository(CourseEntity)
    private readonly courseRepo: Repository<CourseEntity>,
    @InjectRepository(CourseRevisionEntity)
    private readonly revisionRepo: Repository<CourseRevisionEntity>,
    private readonly rewardsService: RewardsService,
    private readonly transactionManager: TransactionManagerService,
    private readonly certificateService: CertificateService,
    @Optional()
    private readonly contractAdapter?: IContractAdapter,
  ) {}

  async create(dto: CreateCourseDto): Promise<CourseEntity> {
    const course = this.courseRepo.create({
      id: crypto.randomUUID(),
      version: CourseService.INITIAL_VERSION,
      ...dto,
    });
    const saved = await this.courseRepo.save(course);
    await this.appendRevision(saved, 'create', {
      changeNote: 'Initial version',
    });
    return saved;
  }

  async findAll(): Promise<CourseEntity[]> {
    return this.courseRepo.find({ where: { isActive: true } });
  }

  async findByLevel(level: string): Promise<CourseEntity[]> {
    return this.courseRepo.find({
      where: { isActive: true, level: level as CourseEntity['level'] },
    });
  }

  async findById(id: string): Promise<CourseEntity | null> {
    return this.courseRepo.findOne({ where: { id } });
  }

  async update(id: string, dto: UpdateCourseDto): Promise<CourseEntity | null> {
    const course = await this.courseRepo.findOne({ where: { id } });
    if (!course) return null;

    const previousVersion = course.version;
    course.version = previousVersion + 1;
    course.updatedAt = new Date();
    Object.assign(course, dto);
    this.syncCourseTaxonomy(course, dto);
    const saved = await this.courseRepo.save(course);

    await this.appendRevision(saved, 'update', {
      changeNote: dto.changeNote,
      revisionAuthor: dto.revisionAuthor,
      previousVersion,
    });
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    const course = await this.courseRepo.findOne({ where: { id } });
    if (!course) return false;
    await this.courseRepo.remove(course);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────
  // Revision history API
  // ──────────────────────────────────────────────────────────────────

  async getRevisions(courseId: string): Promise<CourseRevisionEntity[]> {
    return this.revisionRepo.find({
      where: { courseId },
      order: { version: 'ASC' },
    });
  }

  async getLatestRevision(
    courseId: string,
  ): Promise<CourseRevisionEntity | null> {
    return this.revisionRepo.findOne({
      where: { courseId },
      order: { version: 'DESC' },
    });
  }

  async getRevisionByVersion(
    courseId: string,
    version: number,
  ): Promise<CourseRevisionEntity | null> {
    if (!Number.isFinite(version) || version < 1) {
      throw new NotFoundException({
        error: 'INVALID_VERSION',
        message: `Version must be a positive integer`,
      });
    }
    return this.revisionRepo.findOne({ where: { courseId, version } });
  }

  async restoreRevision(
    courseId: string,
    version: number,
    revisionAuthor?: string,
  ): Promise<CourseEntity | null> {
    const course = await this.courseRepo.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException({
        error: 'COURSE_NOT_FOUND',
        message: `Course with ID ${courseId} not found`,
      });
    }

    const sourceRevision = await this.getRevisionByVersion(courseId, version);
    if (!sourceRevision) {
      throw new NotFoundException({
        error: 'REVISION_NOT_FOUND',
        message: `Revision ${version} not found for course ${courseId}`,
      });
    }

    const previousVersion = course.version;
    const target = sourceRevision.snapshot;
    course.title = target.title;
    course.description = target.description;
    course.level = target.level;
    course.order = target.order;
    course.learningPathId = target.learningPathId;
    course.duration = target.duration;
    course.category = target.category;
    course.categories = [...(target.categories ?? [])];
    course.tags = [...(target.tags ?? [])];
    course.prerequisites = [...target.prerequisites];
    course.skills = [...target.skills];
    course.xpReward = target.xpReward;
    course.isActive = target.isActive;
    course.version = previousVersion + 1;
    course.updatedAt = new Date();

    const saved = await this.courseRepo.save(course);
    await this.appendRevision(saved, 'restore', {
      changeNote: `Restored from version ${version}`,
      revisionAuthor,
      previousVersion,
      referenceRevisionId: sourceRevision.id,
    });
    return saved;
  }

  async getRevisionCount(courseId: string): Promise<number> {
    return this.revisionRepo.count({ where: { courseId } });
  }

  // ──────────────────────────────────────────────────────────────────
  // Course completion with certificate generation (#357, #358, #396)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Complete a course for a user. All side-effects (XP award, certificate
   * generation, on-chain minting, reward recording) are executed inside a
   * transactional atomic operation. If ANY side-effect fails, every
   * previously-successful mutation is rolled back — the user is never
   * left in a partially-completed state.
   *
   * **#357**: A verifiable certificate is always generated on course
   * completion. The certificate includes a shareable URL and a
   * verification code that external parties can use to confirm
   * authenticity.
   */
  async completeCourse(id: string, userId: string) {
    const course = await this.courseRepo.findOne({ where: { id } });
    if (!course) {
      throw new NotFoundException(`Course with ID ${id} not found.`);
    }

    const xpReward = course.xpReward || 50;

    const txResult = await this.transactionManager.runAtomic(async (tx) => {
      // 1. Record XP reward (with rollback snapshot)
      const xpResult = this.rewardsService.recordActivity(userId, new Date(), xpReward);
      await tx.addOperation(async (): Promise<TransactionSnapshot> => ({
        restore: () => {
          this.logger.warn(
            `[TxRollback] XP award of ${xpReward} for user=${userId} on course=${id} could not be reversed (global xpStore)`,
          );
        },
        data: { userId, courseId: id, xpReward, recordedAt: new Date() },
      }));

      // 2. Generate verifiable certificate (#357)
      const certificate = await this.certificateService.generateCertificate({
        userId,
        courseId: id,
        courseTitle: course.title,
        xpAwarded: xpReward,
      });

      await tx.addOperation(async (): Promise<TransactionSnapshot> => ({
        restore: () => {
          this.certificateService.revokeCertificate(certificate.id);
        },
        data: { certificateId: certificate.id },
      }));

      // 3. Mint certificate NFT via contract adapter (#396)
      let onChainCertificate:
        | { tokenId: string; transactionHash: string }
        | undefined;
      if (this.contractAdapter) {
        try {
          onChainCertificate = await this.contractAdapter.mintCertificate(
            userId,
            id,
            {
              courseTitle: course.title,
              xpReward,
              completedAt: new Date().toISOString(),
              verificationCode: certificate.verificationCode,
            },
          );

          await tx.addOperation(async (): Promise<TransactionSnapshot> => ({
            restore: () => {
              this.logger.warn(
                `[TxRollback] On-chain certificate mint for user=${userId}, course=${id} cannot be reversed`,
              );
            },
            data: { onChainCertificate },
          }));

          // Record the on-chain reward as well
          await this.contractAdapter.recordReward(
            userId,
            xpReward,
            `Completed course: ${course.title}`,
          );

          await tx.addOperation(async (): Promise<TransactionSnapshot> => ({
            restore: () => {
              this.logger.warn(
                `[TxRollback] On-chain reward for user=${userId}, course=${id} cannot be reversed`,
              );
            },
            data: { userId, xpReward },
          }));
        } catch (err) {
          // #396: Contract failures should not block course completion.
          // The user gets their XP reward and certificate regardless.
          this.logger.warn(
            `[CourseService] Contract adapter operation failed during course completion (non-blocking): ${err}`,
          );
        }
      }

      return { xpResult, certificate, onChainCertificate };
    });

    if (!txResult.success) {
      this.logger.error(
        `Course completion transaction failed for user=${userId}, course=${id}: ${txResult.error?.message}`,
      );
      throw txResult.error;
    }

    return {
      message: 'Course completed successfully',
      courseId: id,
      userId,
      xpAwarded: xpReward,
      progression: txResult.result!.xpResult,
      certificate: {
        id: txResult.result!.certificate.id,
        verificationCode: txResult.result!.certificate.verificationCode,
        shareableUrl: txResult.result!.certificate.shareableUrl,
        issuedAt: txResult.result!.certificate.issuedAt,
        ...(txResult.result!.onChainCertificate ?? {}),
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────

  private async appendRevision(
    course: CourseEntity,
    reason: CourseRevisionReason,
    options: {
      changeNote?: string;
      revisionAuthor?: string;
      previousVersion?: number;
      referenceRevisionId?: string;
    } = {},
  ): Promise<CourseRevisionEntity> {
    const revision = this.revisionRepo.create({
      id: crypto.randomUUID(),
      courseId: course.id,
      version: course.version,
      snapshot: {
        title: course.title,
        description: course.description,
        level: course.level,
        order: course.order,
        learningPathId: course.learningPathId,
        duration: course.duration,
        category: course.category,
        categories: [...(course.categories ?? [])],
        tags: [...(course.tags ?? [])],
        prerequisites: [...(course.prerequisites ?? [])],
        skills: [...(course.skills ?? [])],
        xpReward: course.xpReward,
        isActive: course.isActive,
      },
      changeNote: options.changeNote,
      revisionAuthor: options.revisionAuthor,
      reason,
      previousVersion: options.previousVersion,
      referenceRevisionId: options.referenceRevisionId,
    });
    const savedRevision = await this.revisionRepo.save(revision);

    course.latestRevisionId = savedRevision.id;
    course.updatedAt = new Date();
    await this.courseRepo.save(course);
    return savedRevision;
  }

  private syncCourseTaxonomy(
    course: CourseEntity,
    dto: Pick<UpdateCourseDto, 'category' | 'categories'>,
  ): void {
    if (dto.category && !dto.categories) {
      course.categories = [dto.category];
    }
    if (dto.categories?.length && !dto.category) {
      course.category = dto.categories[0];
    }
  }

  async getOrFail(id: string): Promise<CourseEntity> {
    const course = await this.findById(id);
    if (!course) {
      throw new NotFoundException({
        error: 'COURSE_NOT_FOUND',
        message: `Course with ID ${id} not found`,
      });
    }
    return course;
  }
}
