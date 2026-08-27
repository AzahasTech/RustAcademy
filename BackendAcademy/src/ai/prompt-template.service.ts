import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Approval metadata recorded for a prompt template version.
 *
 * #653 (BA-085): prompt changes can affect learner safety and grading
 * behaviour, so every version carries a review trail: who approved it,
 * when, and any review notes.
 */
export interface PromptTemplateApproval {
  status: 'approved' | 'pending' | 'rejected';
  approvedBy?: string;
  approvedAt?: Date;
  reviewNotes?: string;
}

/**
 * Rollback metadata recorded when an active template is rolled back.
 *
 * #653 (BA-085): the previous active version keeps a record of what it
 * was rolled back from, by whom, when, and why.
 */
export interface PromptTemplateRollback {
  /** Version that superseded / replaced this one via a rollback. */
  rolledBackFrom?: string;
  rolledBackAt?: Date;
  rolledBackBy?: string;
  reason?: string;
}

/**
 * Represents a single prompt template with its version metadata.
 *
 * #374: Prompt templates are versioned so that changes can be
 * audited, tested, and rolled out in a controlled manner.
 * #653 (BA-085): each version additionally records its author,
 * approval, effective time, and rollback metadata so prompt changes
 * have a full governance trail.
 */
export interface PromptTemplate {
  /** Semantic version of this template */
  version: string;
  /** Human-readable description of the template's purpose */
  description: string;
  /** The system prompt text */
  systemPrompt: string;
  /** Optional role for the assistant */
  assistantRole?: string;
  /** Author of this version (who created/modified it) — #653 */
  author?: string;
  /** Approval trail for this version — #653 */
  approval?: PromptTemplateApproval;
  /** Time from which this version is eligible to be active — #653 */
  effectiveAt?: Date;
  /** Rollback trail — #653 */
  rollback?: PromptTemplateRollback;
  /** Optional metadata about the template */
  metadata?: Record<string, unknown>;
}

/**
 * A collection of prompt templates keyed by template name.
 */
interface PromptTemplateConfig {
  /** Schema version for the config file itself */
  schemaVersion: string;
  templates: Record<string, PromptTemplate[]>;
}

/**
 * Default prompt templates used when no external configuration file
 * is provided. These serve as the baseline v1.0.0 templates.
 *
 * #374: Templates are extracted from inline code into this versioned
 * configuration so they can be audited and evolved independently.
 */
const DEFAULT_TEMPLATES: PromptTemplateConfig = {
  schemaVersion: '1.0.0',
  templates: {
    chat_tutor: [
      {
        version: '1.0.0',
        description: 'Default Rust programming tutor persona for chat interactions.',
        systemPrompt:
          'You are a helpful Rust programming tutor. Provide clear, concise explanations and encourage best practices. When reviewing code, point out potential improvements and explain the reasoning behind them.',
        assistantRole: 'Rust Programming Tutor',
        author: 'platform',
        approval: { status: 'approved', approvedBy: 'platform', approvedAt: new Date('2026-01-01T00:00:00.000Z'), reviewNotes: 'Baseline v1 templates.' },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    code_review: [
      {
        version: '1.0.0',
        description: 'Code review assistant persona.',
        systemPrompt:
          'You are a Rust code reviewer. Analyse the submitted code for correctness, safety, performance, and idiomatic Rust style. Suggest concrete improvements with examples.',
        assistantRole: 'Rust Code Reviewer',
        author: 'platform',
        approval: { status: 'approved', approvedBy: 'platform', approvedAt: new Date('2026-01-01T00:00:00.000Z'), reviewNotes: 'Baseline v1 templates.' },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    hint_generator: [
      {
        version: '1.0.0',
        description: 'Progressive hint generator for coding challenges.',
        systemPrompt:
          'You are a hint generator for Rust coding challenges. Provide hints at three difficulty levels: 1) gentle nudge, 2) more specific guidance, 3) near-solution. Never give the full answer directly.',
        assistantRole: 'Hint Generator',
        author: 'platform',
        approval: { status: 'approved', approvedBy: 'platform', approvedAt: new Date('2026-01-01T00:00:00.000Z'), reviewNotes: 'Baseline v1 templates.' },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    fallback: [
      {
        version: '1.0.0',
        description: 'Fallback responses when AI provider is unavailable.',
        systemPrompt:
          'You are a Rust Academy assistant operating in offline/fallback mode. Provide helpful but generic guidance since you cannot access the AI model at this time.',
        assistantRole: 'Offline Assistant',
        author: 'platform',
        approval: { status: 'approved', approvedBy: 'platform', approvedAt: new Date('2026-01-01T00:00:00.000Z'), reviewNotes: 'Baseline v1 templates.' },
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  },
};

@Injectable()
export class PromptTemplateService implements OnModuleInit {
  private readonly logger = new Logger(PromptTemplateService.name);
  private templates: PromptTemplateConfig = DEFAULT_TEMPLATES;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.loadTemplates();
  }

  /**
   * Loads prompt templates from the configured file path, falling back
   * to the built-in defaults if the file is missing or invalid.
   *
   * #374: Templates are loaded from a version-controlled config file
   * so operators can update prompts without redeploying code.
   */
  private loadTemplates(): void {
    const templatePath = this.configService.get<string>('AI_PROMPT_TEMPLATE_PATH');
    if (!templatePath) {
      this.logger.log('No prompt template path configured; using built-in defaults');
      return;
    }

    const resolvedPath = resolve(process.cwd(), templatePath);
    if (!existsSync(resolvedPath)) {
      this.logger.warn(
        `Prompt template file not found at ${resolvedPath}; using built-in defaults`,
      );
      return;
    }

    try {
      const raw = readFileSync(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw) as PromptTemplateConfig;

      // Basic validation
      if (!parsed.schemaVersion || !parsed.templates) {
        throw new Error('Invalid prompt template config: missing schemaVersion or templates');
      }

      // Merge with defaults — file templates override defaults
      this.templates = {
        schemaVersion: parsed.schemaVersion,
        templates: {
          ...DEFAULT_TEMPLATES.templates,
          ...parsed.templates,
        },
      };

      this.logger.log(
        `Loaded prompt templates from ${resolvedPath} (schema v${parsed.schemaVersion})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to load prompt templates from ${resolvedPath}: ${(err as Error).message}`,
      );
      this.logger.warn('Falling back to built-in default templates');
      this.templates = DEFAULT_TEMPLATES;
    }
  }

  /**
   * Retrieves the system prompt for a given template name and optional
   * version constraint.
   *
   * @param templateName - The name of the template (e.g., 'chat_tutor')
   * @param options - Optional version and metadata overrides
   * @returns The system prompt string
   *
   * #374: Callers specify a template name and optionally a version.
   * If the requested version doesn't exist, the latest available version
   * is returned with a warning logged.
   */
  getSystemPrompt(
    templateName: string,
    options?: { version?: string; metadata?: Record<string, unknown> },
  ): string {
    const active = this.getActiveTemplate(templateName, options?.version);
    if (!active) {
      this.logger.warn(
        `No active template for "${templateName}"; returning generic fallback`,
      );
      return DEFAULT_TEMPLATES.templates.fallback[0].systemPrompt;
    }
    this.logger.debug(
      `Using prompt template "${templateName}" v${active.version} (${active.author ?? 'unknown'} / ${active.approval?.status ?? 'pending'})`,
    );
    return active.systemPrompt;
  }

  /**
   * Returns the currently active template version for a given template name.
   *
   * #653 (BA-085): a version is active only when it is approved and its
   * effective time has been reached, and it has not been rolled back. If a
   * specific version is requested it is honoured when it satisfies those
   * constraints; otherwise the latest eligible version wins.
   */
  getActiveTemplate(
    templateName: string,
    version?: string,
  ): PromptTemplate | null {
    const versions = this.templates.templates[templateName];
    if (!versions || versions.length === 0) return null;
    const now = new Date();

    const eligible = versions.filter(
      (v) =>
        v.approval?.status === 'approved' &&
        !v.rollback &&
        (!v.effectiveAt || v.effectiveAt <= now),
    );
    if (eligible.length === 0) return null;

    if (version) {
      const match = eligible.find((v) => v.version === version);
      if (match) return match;
      this.logger.warn(
        `Version ${version} not active for template "${templateName}"; using latest eligible`,
      );
    }

    return eligible[eligible.length - 1];
  }

  /**
   * Returns the current active template version string for a template name.
   */
  getTemplateVersion(templateName: string): string | null {
    return this.getActiveTemplate(templateName)?.version ?? null;
  }

  /**
   * Records approval metadata for a specific template version.
   *
   * #653 (BA-085): approving a version writes the approver, timestamp, and
   * review notes onto the version so the approval trail is inspectable.
   */
  approveTemplate(
    templateName: string,
    version: string,
    approvedBy: string,
    reviewNotes?: string,
  ): PromptTemplate | null {
    const target = this.findTemplate(templateName, version);
    if (!target) return null;
    target.approval = {
      status: 'approved',
      approvedBy,
      approvedAt: new Date(),
      reviewNotes,
    };
    this.logger.log(
      `Prompt template "${templateName}" v${version} approved by ${approvedBy}`,
    );
    return target;
  }

  /**
   * Records rollback metadata on the currently active version and marks the
   * previous eligible version as active again.
   *
   * #653 (BA-085): the superseded version keeps a record of what it was
   * rolled back from, by whom, when, and why.
   */
  rollbackTemplate(
    templateName: string,
    rolledBackBy: string,
    reason?: string,
  ): PromptTemplate | null {
    const active = this.getActiveTemplate(templateName);
    if (!active) return null;

    active.rollback = {
      rolledBackFrom: this.getPreviousEligibleVersion(templateName, active.version) ?? undefined,
      rolledBackAt: new Date(),
      rolledBackBy,
      reason,
    };
    this.logger.warn(
      `Prompt template "${templateName}" v${active.version} rolled back by ${rolledBackBy}${reason ? `: ${reason}` : ''}`,
    );
    return active;
  }

  /**
   * Returns the audit trail for a template: every version with its author,
   * approval, effective time, and rollback metadata.
   */
  getTemplateAuditTrail(
    templateName: string,
  ): Array<{
    version: string;
    description: string;
    author?: string;
    approval?: PromptTemplateApproval;
    effectiveAt?: Date;
    rollback?: PromptTemplateRollback;
  }> {
    const versions = this.templates.templates[templateName] ?? [];
    return versions.map(({ version, description, author, approval, effectiveAt, rollback }) => ({
      version,
      description,
      author,
      approval,
      effectiveAt,
      rollback,
    }));
  }

  /**
   * Returns all available template names and their versions.
   *
   * #374: Enables auditing of which templates are available and their versions.
   */
  listTemplates(): Array<{ name: string; versions: string[] }> {
    return Object.entries(this.templates.templates).map(([name, versions]) => ({
      name,
      versions: versions.map((v) => v.version),
    }));
  }

  private findTemplate(templateName: string, version: string): PromptTemplate | null {
    const versions = this.templates.templates[templateName];
    return versions?.find((v) => v.version === version) ?? null;
  }

  private getPreviousEligibleVersion(
    templateName: string,
    currentVersion: string,
  ): string | null {
    const versions = this.templates.templates[templateName] ?? [];
    const index = versions.findIndex((v) => v.version === currentVersion);
    if (index <= 0) return null;
    const now = new Date();
    for (let i = index - 1; i >= 0; i--) {
      const v = versions[i];
      if (
        v.approval?.status === 'approved' &&
        !v.rollback &&
        (!v.effectiveAt || v.effectiveAt <= now)
      ) {
        return v.version;
      }
    }
    return null;
  }
}
