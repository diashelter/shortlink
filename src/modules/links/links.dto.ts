import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateLinkDto {
  @IsString()
  @IsNotEmpty()
  destinationUrl!: string;
}

export class ListLinksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['active', 'deactivated', 'all'])
  status?: 'active' | 'deactivated' | 'all';
}

export class LinkIdParamDto {
  @IsUUID()
  linkId!: string;
}
