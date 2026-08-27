import { Module, MiddlewareConsumer, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottleGuard, ThrottleModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChallengesModule } from './challenges/challenges.module';
import { RewardsModule } from './rewards/rewards.module';
import { SecurityModule } from './security/security.module';
import { SubmissionModule } from './submissions/submission.module';
import { TutorProfileModule } from './users/tutor-profile.module';
import { ContractsModule } from './contracts/contracts.module';
import { UserProfileModule } from './users/user-profile.module';
import { AppConfigModule } from './config/config.module';
import { AssetsModule } from './assets/assets.module';
import { PathfindingModule } from './pathfinding/pathfinding.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SearchModule } from './search/search.module';
import { PaymentsModule } from './payments/payments.module';
import { I18nModule } from './i18n/i18n.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { CorrelationIDMiddleware } from './common/correlation-id.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AiModule } from './ai/ai.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WalletModule } from './wallet/wallet.module';
import { SocialModule } from './social/social.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { LessonModule } from './lesson/lesson.module';
import { TaskModule } from './task/task.module';
import { CourseModule } from './course/course.module';
import { LoggingModule } from './logging/logging.module';
import { ProgressModule } from './progress/progress.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    ThrottleModule.forRoot([{ttl: 60000, limit: 10}]),
    AuthModule,
    ContractsModule,
    RedisModule,
    UserProfileModule,
    TutorProfileModule,
    SubmissionModule,
    RewardsModule,
    SecurityModule,
    ChallengesModule,
    AiModule,
    LeaderboardModule,
    AnalyticsModule,
    WalletModule,
    SocialModule,
    OnboardingModule,
    LessonModule,
    TaskModule,
    CourseModule,
    AssetsModule,
    LoggingModule,
    PathfindingModule,
    MonitoringModule,
    ProgressModule,
    SearchModule,
    PaymentsModule,
    I18nModule,
    NotificationsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottleGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true }) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIDMiddleware).forRoutes('*');
  }
}