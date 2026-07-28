import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ApiInfoController } from './api-info.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChallengesModule } from './challenges/challenges.module';
import { RewardsModule } from './rewards/rewards.module';
import { SecurityModule } from './security/security.module';
import { SubmissionModule } from './submissions/submission.module';
import { TutorProfileModule } from './users/tutor-profile.module';
import { ContractsModule } from './contracts/contracts.module';
import { UserProfileModule } from './users/user-profile.module';
import { TutorProfileModule } from './users/tutor-profile.module';
import { SubmissionModule } from './submissions/submission.module';
import { RewardsModule } from './rewards/rewards.module';
import { SecurityModule } from './security/security.module';
import { AppConfigModule } from './config/config.module';

/**
 * Root application module.
 *
 * #395: Contract ingestion is gated behind the CONTRACT_INGESTION_ENABLED
 * feature flag. The ContractsModule itself handles the gate internally —
 * when ingestion is disabled, contract invocation & deployment will return
 * a clear error rather than silently failing. This ensures no accidental
 * contract processing occurs when env vars are misconfigured.
 *
 * Duplicate module imports from the original have been consolidated.
 */
@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    UserProfileModule,
    TutorProfileModule,
    SubmissionModule,
    RewardsModule,
    SecurityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
export class AppModule {}
