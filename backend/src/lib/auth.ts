import crypto from "crypto";
import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function hashPassword(password: string, salt?: string) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, s, 64).toString("hex");
  return `${s}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt] = stored.split(":");
  return hashPassword(password, salt) === stored;
}

export interface AppTokenPayload {
  sub: number;
  email: string;
  istAdmin: boolean;
}

export function signToken(payload: AppTokenPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

export function verifyToken(token: string): AppTokenPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as AppTokenPayload;
}
