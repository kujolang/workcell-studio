import crypto from "node:crypto";
import { LIMITS } from "./limits.js";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function cookieValue(header, name) {
  for (const item of String(header || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1 || item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return null;
}

export class AccessGate {
  constructor({ code = "", production = false, now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
    if (production && !code) throw new Error("STUDIO_ACCESS_CODE is required when NODE_ENV=production");
    if (code && (!/^[\x21-\x7e]{20,128}$/.test(code))) throw new Error("STUDIO_ACCESS_CODE must be 20-128 printable non-whitespace ASCII characters");
    this.enabled = Boolean(code);
    this.expectedHash = code ? sha256(code) : null;
    this.production = production;
    this.cookieName = production ? "__Host-kujo_studio_access" : "kujo_studio_access";
    this.now = now;
    this.randomBytes = randomBytes;
    this.sessions = new Map();
  }

  verifyCode(candidate) {
    if (!this.enabled) return true;
    const actual = crypto.createHash("sha256").update(typeof candidate === "string" ? candidate : "").digest();
    const expected = Buffer.from(this.expectedHash, "hex");
    return crypto.timingSafeEqual(actual, expected);
  }

  purge() {
    const time = this.now();
    for (const [digest, expires] of this.sessions) if (expires <= time) this.sessions.delete(digest);
  }

  issue() {
    this.purge();
    while (this.sessions.size >= LIMITS.maxAccessSessions) this.sessions.delete(this.sessions.keys().next().value);
    const token = this.randomBytes(32).toString("hex");
    this.sessions.set(sha256(token), this.now() + LIMITS.accessTtlMs);
    return token;
  }

  authenticate(header) {
    if (!this.enabled) return true;
    this.purge();
    const token = cookieValue(header, this.cookieName);
    return Boolean(token && /^[a-f0-9]{64}$/.test(token) && this.sessions.has(sha256(token)));
  }

  revoke(header) {
    const token = cookieValue(header, this.cookieName);
    if (token && /^[a-f0-9]{64}$/.test(token)) this.sessions.delete(sha256(token));
  }

  cookie(token) {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(LIMITS.accessTtlMs / 1000)}${this.production ? "; Secure" : ""}`;
  }

  clearCookie() {
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.production ? "; Secure" : ""}`;
  }
}
