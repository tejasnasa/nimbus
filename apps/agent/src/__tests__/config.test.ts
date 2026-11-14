/**
 * @module agent/__tests__/config
 * @description Start-up validation of the agent's environment, and the check on
 * the provider address a session is handed.
 */
import { describe, expect, it } from "vitest";
import { isAllowedProviderUrl, loadConfig } from "../config.js";

const SECRET = "a-shared-secret-of-at-least-32-characters-long";

describe("loadConfig", () => {
  it("accepts an https origin and a long secret, and trims trailing slashes", () => {
    const config = loadConfig({
      NIMBUS_API_URL: "https://api.example.com//",
      NIMBUS_AGENT_SECRET: SECRET,
    });

    expect(config.NIMBUS_API_URL).toBe("https://api.example.com");
    expect(config.NODE_ENV).toBe("production");
  });

  it("refuses an http origin in production", () => {
    expect(() =>
      loadConfig({
        NIMBUS_API_URL: "http://api.example.com",
        NIMBUS_AGENT_SECRET: SECRET,
        NODE_ENV: "production",
      }),
    ).toThrow(/https/);
  });

  it("refuses an http origin when NODE_ENV is not set at all", () => {
    expect(() =>
      loadConfig({ NIMBUS_API_URL: "http://api.example.com", NIMBUS_AGENT_SECRET: SECRET }),
    ).toThrow(/https/);
  });

  it("allows an http origin in development", () => {
    const config = loadConfig({
      NIMBUS_API_URL: "http://localhost:3001",
      NIMBUS_AGENT_SECRET: SECRET,
      NODE_ENV: "development",
    });

    expect(config.NIMBUS_API_URL).toBe("http://localhost:3001");
  });

  it("reads an optional load threshold, and leaves it unset by default", () => {
    const base = {
      NIMBUS_API_URL: "https://api.example.com",
      NIMBUS_AGENT_SECRET: SECRET,
    };
    expect(loadConfig(base).AGENT_LOAD_THRESHOLD).toBeUndefined();
    expect(
      loadConfig({ ...base, AGENT_LOAD_THRESHOLD: "100" }).AGENT_LOAD_THRESHOLD,
    ).toBe(100);
    expect(() => loadConfig({ ...base, AGENT_LOAD_THRESHOLD: "-1" })).toThrow(
      /AGENT_LOAD_THRESHOLD/,
    );
  });

  it("refuses a short secret, naming the variable but not its value", () => {
    const short = "too-short-secret";
    let message = "";
    try {
      loadConfig({ NIMBUS_API_URL: "https://api.example.com", NIMBUS_AGENT_SECRET: short });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("NIMBUS_AGENT_SECRET");
    expect(message).not.toContain(short);
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({})).toThrow(/NIMBUS_API_URL.*NIMBUS_AGENT_SECRET/);
  });

  it("refuses a value that is not a URL", () => {
    expect(() =>
      loadConfig({ NIMBUS_API_URL: "not a url", NIMBUS_AGENT_SECRET: SECRET }),
    ).toThrow(/NIMBUS_API_URL/);
  });

  it("reads process.env by default", () => {
    const before = { ...process.env };
    process.env.NIMBUS_API_URL = "https://api.example.com";
    process.env.NIMBUS_AGENT_SECRET = SECRET;
    try {
      expect(loadConfig().NIMBUS_API_URL).toBe("https://api.example.com");
    } finally {
      process.env = before;
    }
  });
});

describe("isAllowedProviderUrl", () => {
  it("allows https anywhere", () => {
    expect(isAllowedProviderUrl("https://openrouter.ai/api/v1", { NODE_ENV: "production" })).toBe(true);
  });

  it("allows plain http only outside production", () => {
    expect(isAllowedProviderUrl("http://127.0.0.1:4010", { NODE_ENV: "development" })).toBe(true);
    expect(isAllowedProviderUrl("http://127.0.0.1:4010", { NODE_ENV: "test" })).toBe(true);
    expect(isAllowedProviderUrl("http://127.0.0.1:4010", { NODE_ENV: "production" })).toBe(false);
  });

  it("refuses other schemes and garbage", () => {
    expect(isAllowedProviderUrl("ftp://host", { NODE_ENV: "development" })).toBe(false);
    expect(isAllowedProviderUrl("nonsense", { NODE_ENV: "development" })).toBe(false);
  });
});
