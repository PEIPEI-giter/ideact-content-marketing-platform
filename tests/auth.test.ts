import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createAuthService } from "../server/auth";

function response() {
  const headers = new Map<string, string>();
  const value = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn((key: string, item: string) => headers.set(key, item)),
    status: vi.fn((code: number) => { value.statusCode = code; return value; }),
    json: vi.fn((body: unknown) => { value.body = body; return value; }),
    headers,
  };
  return value;
}

function request(body: unknown = {}, cookie = "", ip = "127.0.0.1") {
  return { body, headers: { cookie }, ip, socket: { remoteAddress: ip } } as unknown as Request;
}

describe("single-user authentication", () => {
  it("creates an HttpOnly session and rejects requests after logout", () => {
    const service = createAuthService({ MVP_USER_EMAIL: "peipei", MVP_USER_PASSWORD: "secret" });
    const loginResponse = response();
    service.login(request({ username: "peipei", password: "secret" }), loginResponse as unknown as Response);
    expect(loginResponse.statusCode).toBe(200);
    const setCookie = loginResponse.headers.get("Set-Cookie") || "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = setCookie.split(";")[0];
    const next = vi.fn();
    service.requireAuth(request({}, cookie), response() as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    service.logout(request({}, cookie), response() as unknown as Response);
    const denied = response();
    service.requireAuth(request({}, cookie), denied as unknown as Response, vi.fn());
    expect(denied.statusCode).toBe(401);
  });

  it("limits repeated failed logins and reports missing configuration", () => {
    let clock = 1_000;
    const service = createAuthService({ MVP_USER_EMAIL: "peipei", MVP_USER_PASSWORD: "secret" }, () => clock);
    for (let index = 0; index < 5; index += 1) {
      const denied = response();
      service.login(request({ username: "peipei", password: "wrong" }), denied as unknown as Response);
      expect(denied.statusCode).toBe(401);
    }
    const limited = response();
    service.login(request({ username: "peipei", password: "secret" }), limited as unknown as Response);
    expect(limited.statusCode).toBe(429);
    clock += 15 * 60 * 1000 + 1;
    const accepted = response();
    service.login(request({ username: "peipei", password: "secret" }), accepted as unknown as Response);
    expect(accepted.statusCode).toBe(200);

    const missing = createAuthService({});
    const unavailable = response();
    missing.login(request(), unavailable as unknown as Response);
    expect(unavailable.statusCode).toBe(503);
  });
});
