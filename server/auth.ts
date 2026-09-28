import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "ideact_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

type Session = { username: string; expiresAt: number };
type LoginAttempt = { failures: number; resetAt: number };

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
function cookieValue(header: string | undefined, name: string) {
  for (const part of (header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

export function createAuthService(env: NodeJS.ProcessEnv = process.env, now = () => Date.now()) {
  const username = (env.MVP_USER_EMAIL || "").trim();
  const password = env.MVP_USER_PASSWORD || "";
  const configured = Boolean(username && password);
  const secureCookie = env.MVP_COOKIE_SECURE === "true";
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, LoginAttempt>();

  function sessionFrom(req: Pick<Request, "headers">) {
    const token = cookieValue(req.headers.cookie, COOKIE_NAME);
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return null;
    }
    return { token, ...session };
  }

  function cookie(token: string, maxAgeSeconds: number) {
    return [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      secureCookie ? "Secure" : "",
      `Max-Age=${maxAgeSeconds}`,
    ].filter(Boolean).join("; ");
  }

  function clientKey(req: Request) {
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  function login(req: Request, res: Response) {
    if (!configured) {
      res.status(503).json({ message: "后台登录尚未配置，请在服务端 .env 中填写 MVP_USER_EMAIL 和 MVP_USER_PASSWORD。" });
      return;
    }
    const key = clientKey(req);
    const current = attempts.get(key);
    if (current && current.resetAt > now() && current.failures >= MAX_LOGIN_FAILURES) {
      res.status(429).json({ message: "登录失败次数过多，请 15 分钟后再试。" });
      return;
    }
    const inputUsername = String(req.body?.username || "").trim();
    const inputPassword = String(req.body?.password || "");
    if (!safeEqual(inputUsername, username) || !safeEqual(inputPassword, password)) {
      const attempt = current && current.resetAt > now()
        ? { failures: current.failures + 1, resetAt: current.resetAt }
        : { failures: 1, resetAt: now() + LOGIN_WINDOW_MS };
      attempts.set(key, attempt);
      res.status(401).json({ message: "账号或密码不正确。" });
      return;
    }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { username, expiresAt: now() + SESSION_TTL_MS });
    res.setHeader("Set-Cookie", cookie(token, Math.floor(SESSION_TTL_MS / 1000)));
    res.json({ authenticated: true, user: { username } });
  }

  function logout(req: Request, res: Response) {
    const active = sessionFrom(req);
    if (active) sessions.delete(active.token);
    res.setHeader("Set-Cookie", cookie("", 0));
    res.json({ authenticated: false });
  }

  function status(req: Request, res: Response) {
    const active = sessionFrom(req);
    res.json({ configured, authenticated: Boolean(active), user: active ? { username: active.username } : null });
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!configured) {
      res.status(503).json({ message: "后台登录尚未配置，请先填写服务端登录账号和密码。" });
      return;
    }
    const active = sessionFrom(req);
    if (!active) {
      res.status(401).json({ message: "登录已失效，请重新登录。" });
      return;
    }
    next();
  }

  return { configured, login, logout, status, requireAuth };
}
