import { describe, expect, it } from 'vitest';
import { shouldSynchronizeSchema } from './database.module';

describe('database schema synchronization', () => {
  it('allows synchronization only for local development and tests', () => {
    expect(shouldSynchronizeSchema('development')).toBe(true);
    expect(shouldSynchronizeSchema('test')).toBe(true);
    expect(shouldSynchronizeSchema('staging')).toBe(false);
    expect(shouldSynchronizeSchema('production')).toBe(false);
  });
});
