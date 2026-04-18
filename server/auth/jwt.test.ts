import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * Tests for the JWT helpers + auth middlewares. We mock `../config` so these
 * tests don't need a real .env — they run in complete isolation.
 */

vi.mock("../config", () => ({
  config: {
    JWT_SECRET: "test-secret-that-is-at-least-32-chars-long-for-vitest",
    NODE_ENV: "test",
    isProd: false,
  },
}));

import {
  signAuthToken,
  verifyAuthToken,
  attachAuth,
  requireAuth,
  requireRole,
  requireSelf,
} from "./jwt";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    body: {},
    ...overrides,
  } as Request;
}

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("auth/jwt — token helpers", () => {
  it("signs a token that verifyAuthToken can decode", () => {
    const token = signAuthToken({ sub: "0xabc", role: "user" });
    const decoded = verifyAuthToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe("0xabc");
    expect(decoded!.role).toBe("user");
  });

  it("signed tokens include iat / exp claims", () => {
    const token = signAuthToken({ sub: "0xabc", role: "user" });
    const decoded = verifyAuthToken(token);
    expect(decoded!.iat).toBeTypeOf("number");
    expect(decoded!.exp).toBeTypeOf("number");
    expect(decoded!.exp!).toBeGreaterThan(decoded!.iat!);
  });

  it("verifyAuthToken returns null on garbage input", () => {
    expect(verifyAuthToken("not-a-jwt")).toBeNull();
    expect(verifyAuthToken("")).toBeNull();
  });

  it("verifyAuthToken returns null on an unsigned token", () => {
    // Base64 of {alg:"none", typ:"JWT"}.{sub:"x"}.sig
    const unsigned = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.";
    expect(verifyAuthToken(unsigned)).toBeNull();
  });
});

describe("auth/jwt — attachAuth middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it("populates req.auth when a valid Bearer token is present", () => {
    const token = signAuthToken({ sub: "0xabc", role: "issuer" });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    attachAuth(req, mockRes(), next);
    expect(req.auth).toBeDefined();
    expect(req.auth!.sub).toBe("0xabc");
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves req.auth unset when there is no token", () => {
    const req = mockReq();
    attachAuth(req, mockRes(), next);
    expect(req.auth).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves req.auth unset when the token is invalid", () => {
    const req = mockReq({ headers: { authorization: "Bearer not-a-real-token" } });
    attachAuth(req, mockRes(), next);
    expect(req.auth).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("ignores a header that isn't Bearer", () => {
    const req = mockReq({ headers: { authorization: "Basic foo:bar" } });
    attachAuth(req, mockRes(), next);
    expect(req.auth).toBeUndefined();
  });
});

describe("auth/jwt — requireAuth guard", () => {
  it("401s when req.auth is absent", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when req.auth is present", () => {
    const req = mockReq();
    req.auth = { sub: "0xabc", role: "user" };
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("auth/jwt — requireRole factory", () => {
  it("403s on role mismatch", () => {
    const guard = requireRole("root");
    const req = mockReq();
    req.auth = { sub: "0xabc", role: "user" };
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts any role in the whitelist", () => {
    const guard = requireRole("issuer", "root");
    const req = mockReq();
    req.auth = { sub: "0xabc", role: "issuer" };
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("401s when req.auth is absent", () => {
    const guard = requireRole("root");
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("auth/jwt — requireSelf guard", () => {
  it("accepts when param matches authenticated wallet (case-insensitive)", () => {
    const guard = requireSelf({ param: "addr" });
    const req = mockReq({ params: { addr: "0xABCdef" } });
    req.auth = { sub: "0xabcdef", role: "user" };
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("403s when param is a different address", () => {
    const guard = requireSelf({ param: "addr" });
    const req = mockReq({ params: { addr: "0xDEADBEEF" } });
    req.auth = { sub: "0xabc", role: "user" };
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("400s when the field is missing", () => {
    const guard = requireSelf({ bodyKey: "address" });
    const req = mockReq({ body: {} });
    req.auth = { sub: "0xabc", role: "user" };
    const res = mockRes();
    const next = vi.fn();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
