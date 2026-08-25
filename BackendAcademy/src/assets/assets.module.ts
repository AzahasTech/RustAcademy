import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { SecurityModule } from '../security/security.module';

/**
 * Module exposing asset upload, metadata, download, and delete endpoints
 * to the rest of the BackendAcademy application.
 */
@Module({
  imports: [SecurityModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
