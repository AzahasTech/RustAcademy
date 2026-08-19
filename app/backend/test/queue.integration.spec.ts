import { Test, TestingModule } from '@nestjs/testing';
import { JobQueueService } from '../src/job-queue/job-queue.service';
import { JobRepository } from '../src/job-queue/job.repository';
import { JobRegistry } from '../src/job-queue/job-registry.service';
import { CancellationStore } from '../src/job-queue/cancellation-token';
import { JobQueueMetricsService } from '../src/job-queue/job-queue-metrics.service';
import { SupabaseService } from '../src/supabase/supabase.service';
import { JobType, JobStatus } from '../src/job-queue/types/job.types';

describe('Job Queue Integration & Idempotency', () => {
  let service: JobQueueService;
  let repository: JobRepository;
  let registry: JobRegistry;

  const mockJobsStore = new Map<string, any>();
  const mockIdempotencyStore = new Map<string, any>();

  beforeEach(async () => {
    mockJobsStore.clear();
    mockIdempotencyStore.clear();

    const mockSupabase = {
      getClient: () => ({
        from: (table: string) => ({
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                const id = `job-${Date.now()}-${Math.random()}`;
                const jobRow = {
                  id,
                  type: row.type,
                  payload: row.payload,
                  status: row.status,
                  attempts: row.attempts,
                  max_attempts: row.max_attempts,
                  created_at: new Date().toISOString(),
                  scheduled_at: row.scheduled_at,
                  started_at: null,
                  completed_at: null,
                  failure_reason: null,
                  visibility_timeout: null,
                  idempotency_key: row.idempotency_key || null,
                  retry_metadata: row.retry_metadata || null,
                };
                mockJobsStore.set(id, jobRow);
                if (row.idempotency_key) {
                  mockIdempotencyStore.set(row.idempotency_key, jobRow);
                }
                return { data: jobRow, error: null };
              },
            }),
          }),
          select: (fields?: string) => ({
            eq: (col: string, val: any) => ({
              maybeSingle: async () => {
                if (col === 'id') {
                  const job = mockJobsStore.get(val);
                  return { data: job || null, error: job ? null : { code: 'PGRST116' } };
                }
                if (col === 'idempotency_key') {
                  const job = mockIdempotencyStore.get(val);
                  return { data: job || null, error: job ? null : { code: 'PGRST116' } };
                }
                return { data: null, error: null };
              },
            }),
          }),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobQueueService,
        JobRepository,
        JobRegistry,
        CancellationStore,
        {
          provide: JobQueueMetricsService,
          useValue: {
            incrementJobsEnqueued: jest.fn(),
            updateJobsPendingCount: jest.fn(),
            incrementJobsCancelled: jest.fn(),
          },
        },
        { provide: SupabaseService, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get<JobQueueService>(JobQueueService);
    repository = module.get<JobRepository>(JobRepository);
    registry = module.get<JobRegistry>(JobRegistry);

    // Register a test job handler
    registry.registerHandler({
      type: JobType.EXPORT_GENERATION,
      handler: {
        execute: jest.fn().mockResolvedValue(undefined),
        validate: jest.fn().mockResolvedValue(undefined),
        onFailure: jest.fn().mockResolvedValue(undefined),
      },
      policy: {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        visibilityTimeoutMs: 60000,
      },
    });
  });

  it('should enqueue job successfully and return unique ID', async () => {
    const jobId = await service.enqueue(JobType.EXPORT_GENERATION, { exportId: 'exp-123' });
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe('string');
  });

  it('should suppress duplicate job submissions when matching idempotencyKey is supplied', async () => {
    const idempotencyKey = 'export-key-999';

    const jobId1 = await service.enqueue(
      JobType.EXPORT_GENERATION,
      { exportId: 'exp-123' },
      idempotencyKey,
    );

    const jobId2 = await service.enqueue(
      JobType.EXPORT_GENERATION,
      { exportId: 'exp-123' },
      idempotencyKey,
    );

    expect(jobId1).toEqual(jobId2);
    expect(mockJobsStore.size).toBe(1);
  });

  it('should store and retrieve structured retry metadata on job record', async () => {
    const retryMetadata = {
      attemptCount: 2,
      lastError: 'Network timeout connecting to export storage provider',
      lastFailureAt: new Date().toISOString(),
      nextBackoffDelayMs: 5000,
      inDlq: false,
    };

    const job = await repository.createJob(
      JobType.EXPORT_GENERATION,
      { exportId: 'exp-456' },
      3,
      new Date(),
      'idem-key-777',
      retryMetadata,
    );

    expect(job.idempotencyKey).toBe('idem-key-777');
    expect(job.retryMetadata).toEqual(retryMetadata);
  });
});
