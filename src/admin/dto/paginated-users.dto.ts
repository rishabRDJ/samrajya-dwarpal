import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto.js';

// Envelope for GET /v1/admin/users. `data` + `total` is enough for a client
// to render a paginated table; `page` and `limit` echo what the caller
// sent so they can advance without re-parsing the query string.
export class PaginatedUsersDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty({ example: 42, description: 'Total matching rows across all pages' })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
