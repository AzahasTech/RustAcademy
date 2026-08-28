import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';

@Injectable()
class EnvValidator implements OnModuleInit {
  onModuleInit() {
    const errors: string[] = [];
    const nums: [string, number, number][] = [
      ['PORT', 1, 65535],
      ['SESSION_TTL', 1, 86400],
      ['AI_TIMEOUT', 1000, 30000],
      ['ASS_MAX_SIZE', 1, 104857600],
    ];
    for (const [name, min, max] of nums) {
      const value = process.env[name];
      if (value && (Number.isNaN(+value) || +value < min || +value > max)) {
        errors.push(`${name} must be between ${min} and ${max}`);
      }
    }
    const bools = ['CRON_ENABLED', 'AI_ENABLED'];
    for (const name of bools) {
      const value = process.env[name];
      if (value && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
        errors.push(`${name} must be a boolean`);
      }
    }
    if (errors.length) throw new Error(`Environment validation failed: ${errors.join(', ')}`);
  }
}

@Module({
  controllers: [JobsController],
  providers: [JobsService, EnvValidator],
  exports: [JobsService],
})
export class JobsModule {}
