import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * Represents a single prompt template with its version metadata.
 *
 * #374: Prompt templates are versioned so that changes can be
 * audited, tested, and rolled out in a controlled manner.
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
      },
    ],
    code_review: [
      {
        version: '1.0.0',
        description: 'Code review assistant persona.',
        systemPrompt:
          'You are a Rust code reviewer. Analyse the submitted code for correctness, safety, performance, and idiomatic Rust style. Suggest concrete improvements with examples.',
        assistantRole: 'Rust Code Reviewer',
      },
    ],
    hint_generator: [
      {
        version: '1.0.0',
        description: 'Progressive hint generator for coding challenges.',
        systemPrompt:
          'You are a hint generator for Rust coding challenges. Provide hints at three difficulty levels: 1) gentle nudge, 2) more specific guidance, 3) near-solution. Never give the full answer directly.',
        assistantRole: 'Hint Generator',
      },
    ],
    fallback: [
      {
        version: '1.0.0',
        description: 'Fallback responses when AI provider is unavailable.',
        systemPrompt:
          'You are a Rust Academy assistant operating in offline/fallback mode. Provide helpful but generic guidance since you cannot access the AI model at this time.',
        assistantRole: 'Offline Assistant',
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
    this.reloadTemplates();
  }

  /**
   * Reloads prompt templates from the configured file path. Failed loads keep
   * the currently active configuration, which is the built-in default set at startup.
   *
   * #374: Templates are loaded from a version-controlled config file
   * so operators can update prompts without redeploying code.
   */
  reloadTemplates(): boolean {
    const templatePath = this.configService.get<string>('AI_PROMPT_TEMPLATE_PATH');
    if (!templatePath) {
      this.logger.log('No prompt template path configured; using built-in defaults');
      return false;
    }

    const applicationRoot = resolve(process.cwd());
    const resolvedPath = resolve(applicationRoot, templatePath);
    const pathFromApplicationRoot = relative(applicationRoot, resolvedPath);
    if (
      pathFromApplicationRoot === '..' ||
      pathFromApplicationRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromApplicationRoot)
    ) {
      this.logger.warn('Prompt template path must be within the application directory');
      return false;
    }
    if (!existsSync(resolvedPath)) {
      this.logger.warn(
        `Prompt template file not found at ${resolvedPath}; keeping active templates`,
      );
      return false;
    }

    try {
      const raw = readFileSync(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw) as PromptTemplateConfig;

      if (!this.isValidConfig(parsed)) {
        throw new Error('Invalid prompt template config');
      }

      // Construct the complete candidate before replacing the active configuration.
      const nextTemplates: PromptTemplateConfig = {
        schemaVersion: parsed.schemaVersion,
        templates: {
          ...DEFAULT_TEMPLATES.templates,
          ...parsed.templates,
        },
      };
      this.templates = nextTemplates;

      this.logger.log(
        `Loaded prompt templates from ${resolvedPath} (schema v${parsed.schemaVersion})`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to load prompt templates from ${resolvedPath}: ${(err as Error).message}`,
      );
      this.logger.warn('Keeping the previously active prompt templates');
      return false;
    }
  }

  private isValidConfig(config: PromptTemplateConfig): boolean {
    if (
      !config ||
      typeof config !== 'object' ||
      typeof config.schemaVersion !== 'string' ||
      !config.schemaVersion ||
      !config.templates ||
      typeof config.templates !== 'object' ||
      Array.isArray(config.templates)
    ) {
      return false;
    }

    return Object.values(config.templates).every(
      (versions) =>
        Array.isArray(versions) &&
        versions.length > 0 &&
        versions.every(
          (template) =>
            !!template &&
            typeof template === 'object' &&
            typeof template.version === 'string' &&
            typeof template.description === 'string' &&
            typeof template.systemPrompt === 'string' &&
            (template.assistantRole === undefined ||
              typeof template.assistantRole === 'string') &&
            (template.metadata === undefined ||
              (typeof template.metadata === 'object' &&
                template.metadata !== null &&
                !Array.isArray(template.metadata))),
        ),
    );
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
    const versions = this.templates.templates[templateName];

    if (!versions || versions.length === 0) {
      this.logger.warn(
        `No templates found for "${templateName}"; returning generic fallback`,
      );
      return DEFAULT_TEMPLATES.templates.fallback[0].systemPrompt;
    }

    // If a specific version is requested, try to find it
    if (options?.version) {
      const match = versions.find((v) => v.version === options.version);
      if (match) {
        this.logger.debug(`Using prompt template "${templateName}" v${match.version}`);
        return match.systemPrompt;
      }
      this.logger.warn(
        `Version ${options.version} not found for template "${templateName}"; using latest`,
      );
    }

    // Return the latest version (last in array)
    const latest = versions[versions.length - 1];
    this.logger.debug(
      `Using prompt template "${templateName}" v${latest.version} (latest)`,
    );
    return latest.systemPrompt;
  }

  /**
   * Returns the current active template version for a given template name.
   */
  getTemplateVersion(templateName: string): string | null {
    const versions = this.templates.templates[templateName];
    if (!versions || versions.length === 0) return null;
    return versions[versions.length - 1].version;
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
}
