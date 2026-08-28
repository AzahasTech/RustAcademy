import { Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';
import { UsernamesModule } from '../usernames/usernames.module';
import { AuditModule } from '../audit/audit.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

@Module({
  // AuditModule is imported so the @SensitiveMutation-tagged mutation
  // routes below can resolve AuditInterceptor's dependencies (Issue #551).
  imports: [SupabaseModule, UsernamesModule, AuditModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
