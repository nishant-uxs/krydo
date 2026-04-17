import type { Request, Response } from "express";
import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, type PageOpts, type PageResult } from "../storage";

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
    return { limit: DEFAULT_PAGE_LIMIT };
  }
  return { limit: parsed.data.limit, cursor: parsed.data.cursor ?? null };
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
