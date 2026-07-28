import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';

/**
 * Application config module with contract-specific environment
 * variable validation (#395, #396).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}