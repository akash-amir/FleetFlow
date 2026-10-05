/** Shared list-response shape, reused by every paginated module endpoint. */
export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}
