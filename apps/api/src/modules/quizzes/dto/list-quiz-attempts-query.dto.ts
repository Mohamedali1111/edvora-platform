import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class ListQuizAttemptsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(UUID_PARAM_PATTERN)
  studentUserId?: string;

  // Query strings are always raw text, so `true`/`false` must be explicitly coerced before
  // `@IsBoolean()` validates the result — there is no existing boolean-query-param convention in
  // this repository to reuse, so this is a small, self-contained, narrowly-scoped one. Any other
  // raw value is left as-is and rejected by `@IsBoolean()`, not silently coerced.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  passed?: boolean;
}
