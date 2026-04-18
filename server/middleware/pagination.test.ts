import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { readPageOpts, sendPage } from "./pagination";

/**
 * Tests for the shared ?limit=&cursor= parser + X-Next-Cursor responder.
 */

function mockReq(query: Record<string, unknown> = {}): Request {
  return { query } as unknown as Request;
}

function mockRes() {
  const headers: Record<string, string> = {};
  const res: Partial<Response> = {};
  res.setHeader = vi.fn((name: string, value: string) => {
    headers[name] = value;
    return res as Response;
  }) as any;
  res.json = vi.fn().mockReturnThis();
  return { res: res as Response, headers };
}

describe("middleware/pagination — readPageOpts", () => {
  it("returns defaults when no query params are provided", () => {
    const opts = readPageOpts(mockReq());
    expect(opts.limit).toBe(50);
    expect(opts.cursor).toBeNull();
  });

  it("parses numeric limit", () => {
    const opts = readPageOpts(mockReq({ limit: "25" }));
    expect(opts.limit).toBe(25);
  });

  it("clamps invalid limits to the default", () => {
    // Zod rejects these, so readPageOpts returns the default object.
    const bad = readPageOpts(mockReq({ limit: "-5" }));
    expect(bad.limit).toBe(50);
  });

  it("clamps limits above MAX to the default fallback", () => {
    // Zod rejects values > MAX_PAGE_LIMIT (200); readPageOpts returns default 50.
    const over = readPageOpts(mockReq({ limit: "9999" }));
    expect(over.limit).toBe(50);
  });

  it("passes through cursor strings", () => {
    const opts = readPageOpts(mockReq({ cursor: "abc123" }));
    expect(opts.cursor).toBe("abc123");
  });

  it("rejects cursor strings longer than 256 chars", () => {
    const longCursor = "a".repeat(300);
    const opts = readPageOpts(mockReq({ cursor: longCursor }));
    // Validation fails → default opts object, cursor explicitly null.
    expect(opts.cursor).toBeNull();
  });

  it("is tolerant of extra unknown query params (Zod strip)", () => {
    const opts = readPageOpts(mockReq({ limit: "10", foo: "bar" }));
    expect(opts.limit).toBe(10);
  });
});

describe("middleware/pagination — sendPage", () => {
  it("sets X-Next-Cursor header when there is a next cursor", () => {
    const { res, headers } = mockRes();
    sendPage(res, { items: [{ id: 1 }, { id: 2 }], nextCursor: "xyz" });
    expect(headers["X-Next-Cursor"]).toBe("xyz");
    expect(headers["X-Page-Size"]).toBe("2");
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
  });

  it("omits X-Next-Cursor when nextCursor is null", () => {
    const { res, headers } = mockRes();
    sendPage(res, { items: [{ id: 1 }], nextCursor: null });
    expect(headers["X-Next-Cursor"]).toBeUndefined();
    expect(headers["X-Page-Size"]).toBe("1");
  });

  it("always emits X-Page-Size, even for empty pages", () => {
    const { res, headers } = mockRes();
    sendPage(res, { items: [], nextCursor: null });
    expect(headers["X-Page-Size"]).toBe("0");
    expect(res.json).toHaveBeenCalledWith([]);
  });
});
