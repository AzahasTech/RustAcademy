import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { validationSchema } from './env.schema';

/**
 * Application config module with contract-specific environment
 * variable validation (#395, #396).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      validationOptions: {
        // Report every invalid variable at once and coerce string env
        // values to their declared types (numbers, booleans, lists, JSON).
        abortEarly: false,
        allowUnknown: true,
        convert: true,
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}