import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { XpEventType } from '../xp.types';

export const XP_AWARD_POLICY: Readonly<Record<XpEventType, number>> = {
  'task.passed': 10,
  'course.completed': 100,
  'streak.day': 5,
  'contribution.created': 25,
};

export const XP_HISTORY_DEFAULT_LIMIT = 20;
export const XP_HISTORY_MAX_LIMIT = 100;

export class PublishXpEventDto {
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsIn(['task.passed', 'course.completed', 'streak.day', 'contribution.created'])
  type: XpEventType;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  amount?: number;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
