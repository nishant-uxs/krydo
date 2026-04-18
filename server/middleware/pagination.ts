import type { Request, Response } from "express";
import { z } from "zod";

/**
 * Pagination contract shared by storage + middleware. Defining it here rather
 * than in storage.ts keeps this module importable from tests (and any other
 * code path) without pulling the whole Firebase Admin SDK in transitively.
 */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** Client-supplied pagination hint. Cursor is an opaque doc id. */
export interface PageOpts {
  limit?: number;
  cursor?: string | null;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

/** Zod schema for `?limit=&cursor=` query params. */
const pageQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).optional(),
  cursor: z.string().trim().min(1).max(256).optional(),
});

/**
 * Parse ?limit= and ?cursor= from the request. Returns sane defaults if
 * missing or malformed (never throws — bad values just fall back to defaults).
 */
export function readPageOpts(req: Request): PageOpts {
  const parsed = pageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return { limit: DEFAULT_PAGE_LIMIT, cursor: null };
  }
  return {
    limit: parsed.data.limit ?? DEFAULT_PAGE_LIMIT,
    cursor: parsed.data.cursor ?? null,
  };
}

/**
 * Serialize a PageResult<T> into the HTTP response:
 * - Body:   the items array (unchanged shape for existing frontends).
 * - Header: X-Next-Cursor when there is more data available.
 * - Header: X-Page-Size for observability.
 */
export function sendPage<T>(res: Response, page: PageResult<T>) {
  if (page.nextCursor) res.setHeader("X-Next-Cursor", page.nextCursor);
  res.setHeader("X-Page-Size", String(page.items.length));
  res.json(page.items);
}
