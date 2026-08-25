import { Module } from '@nestjs/common';
import { AntiCheatController } from './anti-cheat.controller';
import { AntiCheatService } from './anti-cheat.service';
import { SecurityService } from './security.service';

@Module({
  controllers: [AntiCheatController],
  providers: [AntiCheatService, SecurityService],
  exports: [AntiCheatService, SecurityService],
})
export class SecurityModule {}
