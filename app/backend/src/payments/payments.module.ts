import { Module } from "@nestjs/common";
import { HorizonService } from "../transactions/horizon.service";
import { PaymentsController } from "./payments.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  // AuditModule is imported so the @SensitiveMutation-tagged route above
  // can resolve AuditInterceptor's dependencies (Issue #551).
  imports: [AuditModule],
  controllers: [PaymentsController],
  providers: [HorizonService],
  exports: [],
})
export class PaymentsModule {}
