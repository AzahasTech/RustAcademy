import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validationSchema } from './env.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Same lookup order everywhere; missing files are ignored, so
      // container deployments that inject env directly are unaffected.
      envFilePath: ['.env.local', '.env'],
      expandVariables: true,
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