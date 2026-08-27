import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().optional(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        JWT_SECRET: Joi.string().optional(),
        /**
         * Maximum allowed clock skew (in seconds) tolerated when verifying
         * token `exp`/`nbf` claims. Distributed clocks can drift, so a small
         * bounded tolerance prevents premature expiry or rejection of tokens
         * issued by a peer whose clock is slightly ahead/behind. Bounded here
         * to a hard maximum so the window cannot be widened inadvertently.
         */
        JWT_CLOCK_SKEW_SECONDS: Joi.number().integer().min(0).max(120).default(30),
      }),
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
