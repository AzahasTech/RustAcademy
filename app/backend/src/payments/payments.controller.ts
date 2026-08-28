import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

import { HorizonService } from "../transactions/horizon.service";
import { SensitiveMutation } from "../auth/decorators/sensitive-mutation.decorator";

type RecentPaymentsQuery = {
  address: string;
  since?: string; // ISO timestamp or epoch ms
  limit?: number;
};

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly horizonService: HorizonService) {}

  // Read-only, but payment-sensitive: exposes an address's payment history,
  // which is a reconnaissance target for scraping/enumeration. Tagged
  // "sensitive" (Issue #551) for the stricter per-user+per-IP limits and
  // the audit trail, even though it has no side effects of its own.
  @Get("recent")
  @SensitiveMutation("payments.recent.query")
  @ApiOperation({
    summary: "Fetch recent payments for an address (since timestamp)",
  })
  @ApiResponse({ status: 200, description: "List of recent payments" })
  async recent(@Query() query: RecentPaymentsQuery) {
    const { address, since, limit = 20 } = query;

    if (!address) {
      return { items: [] };
    }

    // HorizonService.getPayments returns items sorted desc by created_at
    const resp = await this.horizonService.getPayments(
      address,
      undefined,
      Number(limit),
    );

    const sinceTs = since ? parseSince(since) : undefined;

    const filtered = sinceTs
      ? resp.items.filter((it) => new Date(it.timestamp).getTime() > sinceTs)
      : resp.items;

    return { items: filtered };
  }
}

function parseSince(raw?: string): number | undefined {
  if (!raw) return undefined;
  // accept epoch ms or ISO
  const n = Number(raw);
  if (!Number.isNaN(n) && n > 0) return n;
  const d = Date.parse(raw);
  return Number.isNaN(d) ? undefined : d;
}
