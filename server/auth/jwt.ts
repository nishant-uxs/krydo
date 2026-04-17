import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import type { WalletRole } from "@shared/schema";

export interface AuthPayload {
  sub: string; // lowercased wallet address
  role: WalletRole;
  iat?: number;
  exp?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

const TOKEN_TTL = "7d";

export function signAuthToken(payload: Omit<AuthPayload, "iat" | "exp">): string {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyAuthToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (typeof decoded !== "object" || decoded === null) return null;
    return decoded as AuthPayload;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

/** Populates req.auth if a valid token is present. Never rejects. */
export function attachAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyAuthToken(token);
    if (payload) req.auth = payload;
  }
  next();
}

/** Guard: rejects with 401 if no valid token. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

/** Guard factory: rejects unless the authenticated role is in the whitelist. */
export function requireRole(...allowed: WalletRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!allowed.includes(req.auth.role)) {
      return res.status(403).json({ message: "Insufficient role" });
    }
    next();
  };
}

/**
 * Guard: authenticated user must match the address in the given param/body field.
 * Prevents acting on behalf of another wallet via forged request bodies.
 */
export function requireSelf(field: { param?: string; bodyKey?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const candidate = field.param
      ? (req.params[field.param] as string | undefined)
      : field.bodyKey
        ? (req.body?.[field.bodyKey] as string | undefined)
        : undefined;
    if (!candidate || typeof candidate !== "string") {
      return res.status(400).json({ message: "Address missing from request" });
    }
    if (candidate.toLowerCase() !== req.auth.sub.toLowerCase()) {
      return res.status(403).json({ message: "Address does not match authenticated wallet" });
    }
    next();
  };
}
