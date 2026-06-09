// Shared pagination helpers for list endpoints.
//
// Goal: large "get all" endpoints must never ship an unbounded result set to a
// client. Even when the client omits pagination params, the server enforces a
// hard cap. Endpoints that opt into real paging return a bounded page plus a
// total count via `buildPage`.

export const DEFAULT_PAGE_SIZE = 25;
// Hard ceiling for a single list response. Directory-style endpoints that still
// return a bare array (for pickers) clamp to this so an unbounded fetch is
// impossible regardless of client params.
export const MAX_PAGE_SIZE = 200;

export interface PaginationParams {
  limit: number;
  offset: number;
  // True when the client supplied any pagination param (limit/offset/page/
  // pageSize). Endpoints use this to decide between the paginated envelope and
  // the legacy bare-array response.
  paginated: boolean;
}

export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

function toInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse limit/offset (or page/pageSize) from a query object, enforcing a
 * default size and a hard maximum. Supports two param styles:
 *   - limit + offset
 *   - page (1-based) + pageSize
 */
export function parsePagination(
  query: Record<string, unknown>,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): PaginationParams {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;

  const rawLimit = toInt(query.limit);
  const rawOffset = toInt(query.offset);
  const rawPage = toInt(query.page);
  const rawPageSize = toInt(query.pageSize);

  const paginated =
    rawLimit !== undefined ||
    rawOffset !== undefined ||
    rawPage !== undefined ||
    rawPageSize !== undefined;

  let limit = rawLimit ?? rawPageSize ?? defaultLimit;
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(Math.max(1, Math.floor(limit)), maxLimit);

  let offset: number;
  if (rawOffset !== undefined) {
    offset = rawOffset;
  } else if (rawPage !== undefined) {
    offset = (Math.max(1, rawPage) - 1) * limit;
  } else {
    offset = 0;
  }
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  return { limit, offset, paginated };
}

export function buildPage<T>(rows: T[], total: number, params: PaginationParams): Page<T> {
  return { data: rows, total, limit: params.limit, offset: params.offset };
}
