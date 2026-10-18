import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmpty,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

export const SUPPORTED_SANDBOX_LANGUAGES = ["rust"] as const;

export type SandboxLanguage = (typeof SUPPORTED_SANDBOX_LANGUAGES)[number];

export class RunCodeDto {
  @isString()
  @IsNotEmpty()
  @MaxLength(100_000)
  source: string;

  @IsOptional()
  @IsIn(SUPPORTED_SANDBOX_LANGUAGES)
  language?: SandboxLanguage;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(16_384, { each: true })
  testCases?: string[];

  @ValidateIf((dto: RunCodeDto) => dto.testCases !== undefined)
  @IsString()
  @MaxLength(64 * 1024)
  expectedOutput?: string;
}
