import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtLearnerGuard } from './guards/jwt-learner.guard';
import { JwtTutorGuard } from './guards/jwt-tutor.guard';
import { JwtAdminGuard } from './guards/jwt-admin.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        // Bounded clock skew (seconds) tolerated on token `exp`/`nbf` checks.
        // Applies at verification so tokens issued by a peer whose clock is
        // slightly ahead/behind are neither rejected prematurely nor accepted
        // once far beyond their lifetime.
        const clockSkewSeconds = config.get<number>('JWT_CLOCK_SKEW_SECONDS', 30);
        return {
          secret: config.get<string>('JWT_SECRET', 'changeme'),
          signOptions: { expiresIn: '7d' },
          verifyOptions: {
            clockTolerance: clockSkewSeconds,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [JwtLearnerGuard, JwtTutorGuard, JwtAdminGuard, RolesGuard],
  exports: [JwtModule, JwtLearnerGuard, JwtTutorGuard, JwtAdminGuard, RolesGuard],
})
export class AuthModule {}
