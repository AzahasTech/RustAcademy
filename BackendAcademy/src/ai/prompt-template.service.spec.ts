import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PromptTemplateService, PromptTemplate } from './prompt-template.service';

function createConfigService() {
  return { get: jest.fn(() => undefined) } as unknown as ConfigService;
}

interface TemplatesShape {
  schemaVersion: string;
  templates: Record<string, PromptTemplate[]>;
}

/** Adds a second, pending version on top of the built-in defaults. */
function injectTemplates(service: PromptTemplateService, extra: PromptTemplate[]): void {
  const config = (service as unknown as { templates: TemplatesShape }).templates;
  const current = [...(config.templates.chat_tutor ?? [])];
  (service as unknown as { templates: TemplatesShape }).templates = {
    ...config,
    templates: { ...config.templates, chat_tutor: [...current, ...extra] },
  };
}

describe('PromptTemplateService — approval & audit metadata (Issue #653 / BA-085)', () => {
  let service: PromptTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptTemplateService, { provide: ConfigService, useValue: createConfigService() }],
    }).compile();
    service = module.get<PromptTemplateService>(PromptTemplateService);
  });

  describe('built-in templates', () => {
    it('records author, approval, and effective time on the active version', () => {
      const active = service.getActiveTemplate('chat_tutor');
      expect(active).not.toBeNull();
      expect(active?.author).toBe('platform');
      expect(active?.approval?.status).toBe('approved');
      expect(active?.approval?.approvedBy).toBe('platform');
      expect(active?.approval?.approvedAt).toBeInstanceOf(Date);
      expect(active?.effectiveAt).toBeInstanceOf(Date);
    });

    it('returns the active version string', () => {
      expect(service.getTemplateVersion('chat_tutor')).toBe('1.0.0');
      expect(service.getSystemPrompt('chat_tutor')).toContain('Rust programming tutor');
    });

    it('exposes an audit trail with governance metadata', () => {
      const trail = service.getTemplateAuditTrail('chat_tutor');
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({
        version: '1.0.0',
        author: 'platform',
        approval: { status: 'approved' },
      });
      expect(trail[0].effectiveAt).toBeInstanceOf(Date);
    });
  });

  describe('approval workflow', () => {
    it('does not select a pending version', () => {
      injectTemplates(service, [
        {
          version: '1.1.0',
          description: 'Draft changes',
          systemPrompt: 'Draft tutor prompt.',
          author: 'learner-success',
          approval: { status: 'pending' },
        },
      ]);
      expect(service.getTemplateVersion('chat_tutor')).toBe('1.0.0');
    });

    it('selects an approved version once approval is recorded', () => {
      injectTemplates(service, [
        {
          version: '1.1.0',
          description: 'Draft changes',
          systemPrompt: 'New tutor prompt.',
          author: 'learner-success',
          approval: { status: 'pending' },
        },
      ]);
      const approved = service.approveTemplate('chat_tutor', '1.1.0', 'reviewer-1', 'Looks good');
      expect(approved?.approval).toMatchObject({
        status: 'approved',
        approvedBy: 'reviewer-1',
      });
      expect(approved?.approval?.approvedAt).toBeInstanceOf(Date);
      expect(service.getTemplateVersion('chat_tutor')).toBe('1.1.0');
      expect(service.getSystemPrompt('chat_tutor')).toBe('New tutor prompt.');
    });

    it('does not select a version whose effective time is in the future', () => {
      injectTemplates(service, [
        {
          version: '1.1.0',
          description: 'Scheduled changes',
          systemPrompt: 'Scheduled tutor prompt.',
          author: 'learner-success',
          approval: { status: 'approved', approvedBy: 'reviewer-1', approvedAt: new Date() },
          effectiveAt: new Date(Date.now() + 86_400_000), // tomorrow
        },
      ]);
      expect(service.getTemplateVersion('chat_tutor')).toBe('1.0.0');
    });
  });

  describe('rollback workflow', () => {
    it('records rollback metadata and falls back to the previous active version', () => {
      injectTemplates(service, [
        {
          version: '1.1.0',
          description: 'New version',
          systemPrompt: 'New tutor prompt.',
          author: 'learner-success',
          approval: { status: 'approved', approvedBy: 'reviewer-1', approvedAt: new Date() },
        },
      ]);
      expect(service.getTemplateVersion('chat_tutor')).toBe('1.1.0');

      const rolledBack = service.rollbackTemplate('chat_tutor', 'ops-1', 'Prompt caused regressions');
      expect(rolledBack?.rollback).toMatchObject({
        rolledBackBy: 'ops-1',
        reason: 'Prompt caused regressions',
        rolledBackFrom: '1.0.0',
      });
      expect(rolledBack?.rollback?.rolledBackAt).toBeInstanceOf(Date);

      // After rollback, the previous eligible version is active again.
      expect(service.getTemplateVersion('chat_tutor')).toBe('1.0.0');
      expect(service.getSystemPrompt('chat_tutor')).toContain('Rust programming tutor');
    });

    it('records the rollback in the audit trail', () => {
      injectTemplates(service, [
        {
          version: '1.1.0',
          description: 'New version',
          systemPrompt: 'New tutor prompt.',
          author: 'learner-success',
          approval: { status: 'approved', approvedBy: 'reviewer-1', approvedAt: new Date() },
        },
      ]);
      service.rollbackTemplate('chat_tutor', 'ops-1', 'Rolling back');

      const trail = service.getTemplateAuditTrail('chat_tutor');
      const v110 = trail.find((t) => t.version === '1.1.0');
      expect(v110?.rollback).toMatchObject({ rolledBackBy: 'ops-1', rolledBackFrom: '1.0.0' });
      expect(v110?.approval?.status).toBe('approved'); // approval history preserved
    });
  });
});
