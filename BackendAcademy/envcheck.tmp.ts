import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { envValidationSchema, ENV_VALIDATION_OPTIONS, NON_PRODUCTION_DEFAULTS } from './src/config/env.schema';

function run(label: string, env: Record<string, unknown>) {
  const { error, value } = envValidationSchema.validate(env, ENV_VALIDATION_OPTIONS);
  console.log('---', label);
  if (error) console.log('  ERROR:', error.message);
  else console.log('  OK  ', JSON.stringify({
    NODE_ENV: value.NODE_ENV, PORT: value.PORT, CORS_ORIGIN: value.CORS_ORIGIN,
    DATABASE_URL: value.DATABASE_URL, REDIS_HOST: value.REDIS_HOST, REDIS_PORT: value.REDIS_PORT,
    JWT_SECRET: value.JWT_SECRET, ASSET_SIGNING_SECRET: value.ASSET_SIGNING_SECRET,
    AI_PROVIDER: value.AI_PROVIDER, ASSETS_MAX_SIZE_MB: value.ASSETS_MAX_SIZE_MB,
  }));
}

run('empty (development)', {});
run('test', { NODE_ENV: 'test' });
run('example env file', dotenv.parse(fs.readFileSync('.env.example')));
run('production empty', { NODE_ENV: 'production' });
run('production with placeholder secrets', {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:supersecretpw@db:5432/app',
  REDIS_HOST: 'redis',
  JWT_SECRET: 'change_me_in_production',
  ASSET_SIGNING_SECRET: NON_PRODUCTION_DEFAULTS.development.ASSET_SIGNING_SECRET,
});
run('production short secret', {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:supersecretpw@db:5432/app',
  REDIS_HOST: 'redis',
  JWT_SECRET: 'tooshort-abc',
  ASSET_SIGNING_SECRET: 'x'.repeat(40),
});
run('production bad db url', {
  NODE_ENV: 'production',
  DATABASE_URL: 'ftp://user:supersecretpw@db/app',
  REDIS_HOST: 'redis',
  JWT_SECRET: 'a'.repeat(40),
  ASSET_SIGNING_SECRET: 'b'.repeat(40),
});
run('production valid', {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:pw@db:5432/app',
  REDIS_HOST: 'redis',
  JWT_SECRET: 'a'.repeat(40),
  ASSET_SIGNING_SECRET: 'b'.repeat(40),
  CORS_ORIGIN: 'https://a.example, https://b.example',
});
run('claude without key', { AI_PROVIDER: 'claude' });
run('unknown vars', { PATH: '/usr/bin', SOME_RANDOM: 'x' });
run('bad node env', { NODE_ENV: 'staging' });
run('bad redis port', { REDIS_PORT: -1 });
