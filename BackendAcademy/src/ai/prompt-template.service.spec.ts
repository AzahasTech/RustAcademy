import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { PromptTemplateService } from './prompt-template.service';

describe('PromptTemplateService reloads', () => {
  let fixtureDirectory: string;
  let configPath: string;
  let configuredPath: string;
  let service: PromptTemplateService;

  beforeEach(() => {
    fixtureDirectory = mkdtempSync(join(process.cwd(), '.prompt-template-test-'));
    configPath = join(fixtureDirectory, 'templates.json');
    configuredPath = relative(process.cwd(), configPath);
    service = new PromptTemplateService({ get: jest.fn(() => configuredPath) } as any);
  });

  afterEach(() => {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it('keeps the last valid templates when a later reload is malformed', () => {
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: '1.0.0',
      templates: { chat_tutor: [{ version: '2.0.0', description: 'Test', systemPrompt: 'Use the reloaded prompt.', approval: { status: 'approved' } }] },
    }));

    expect(service.reloadTemplates()).toBe(true);
    expect(service.getSystemPrompt('chat_tutor')).toBe('Use the reloaded prompt.');

    writeFileSync(configPath, '{not valid JSON');
    expect(service.reloadTemplates()).toBe(false);
    expect(service.getSystemPrompt('chat_tutor')).toBe('Use the reloaded prompt.');
    expect(service.getTemplateVersion('chat_tutor')).toBe('2.0.0');
  });

  it('rejects a path that escapes the application directory', () => {
    const traversalService = new PromptTemplateService({ get: jest.fn(() => '../templates.json') } as any);

    expect(traversalService.reloadTemplates()).toBe(false);
    expect(traversalService.getTemplateVersion('chat_tutor')).toBe('1.0.0');
  });

  it('does not activate a syntactically valid but structurally invalid config', () => {
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: '1.0.0', templates: { chat_tutor: [{ version: '2.0.0' }] },
    }));

    expect(service.reloadTemplates()).toBe(false);
    expect(service.getTemplateVersion('chat_tutor')).toBe('1.0.0');
  });
});
