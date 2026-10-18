import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swgger";
import { RunCodeDto } from "./dto/run-code.dto";
import { SandboxService } from "./sandbox.service";

@ApiTags("sandbox")
@Controller("tasks")
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Post("run")
  run(@Body() dto: RunCodeDto) {
    this.sandbox.validateLanguage(dto.language);

    if (dto.testCases !== undefined) {
      return this.sandbox.runRustTests(
        dto.source,
        dto.testCases,
        dto.expectedOutput,
        dto.timeoutMs,
      );
    }
    return this.sandbox.runRust(dto.source, dto.timeoutMs);
  }
}
