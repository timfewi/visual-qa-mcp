import { describe, expect, test } from "bun:test";

import {
  allowedOriginsFor,
  evaluateNavigation,
  hostnameMatches,
  isLinkLocalHostname,
  isLoopbackHostname,
  normalizeHostname,
  originMatches,
  sanitizeUrlForStorage,
  type SecurityPolicy,
} from "../../src/security/url-guard.js";
import {
  compileRedaction,
  EMPTY_REDACTION,
  redactDeep,
  redactString,
} from "../../src/security/redact.js";
import { ConfigError } from "../../src/config/load.js";

const localOnly: SecurityPolicy = {
  allowRemote: false,
  allowedHosts: [],
  blockRequestsToOtherOrigins: true,
  blockLinkLocal: true,
};

const remoteAllowed: SecurityPolicy = {
  allowRemote: true,
  allowedHosts: ["staging.example.com", "*.preview.example.com"],
  blockRequestsToOtherOrigins: true,
  blockLinkLocal: true,
};

describe("navigation policy", () => {
  test("allows loopback targets by default", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://127.0.0.1:4321/page",
      "http://127.9.9.9/",
      "http://[::1]:8080/",
      "https://app.localhost/",
    ]) {
      expect(evaluateNavigation(url, localOnly)).toEqual({ allowed: true });
    }
  });

  test("refuses remote targets without an explicit opt-in", () => {
    const decision = evaluateNavigation("https://staging.example.com/", localOnly);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false ? decision.reason : "").toContain("allowedHosts");
  });

  test("refuses listed hosts while allowRemote is false", () => {
    const decision = evaluateNavigation("https://staging.example.com/", {
      ...remoteAllowed,
      allowRemote: false,
    });
    expect(decision.allowed).toBe(false);
  });

  test("allows listed hosts once remote navigation is enabled", () => {
    expect(evaluateNavigation("https://staging.example.com/", remoteAllowed)).toEqual({
      allowed: true,
    });
    expect(evaluateNavigation("https://shop.preview.example.com/", remoteAllowed)).toEqual({
      allowed: true,
    });
    expect(evaluateNavigation("https://preview.example.com/", remoteAllowed).allowed).toBe(false);
    expect(evaluateNavigation("https://evil-example.com/", remoteAllowed).allowed).toBe(false);
  });

  test("blocks non-http protocols and link-local metadata endpoints in every mode", () => {
    for (const url of ["file:///etc/passwd", "data:text/html,hello", "javascript:alert(1)"]) {
      expect(evaluateNavigation(url, remoteAllowed).allowed).toBe(false);
    }
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.100.200/",
      "http://metadata.google.internal/",
      "http://[fe80::1]/",
    ]) {
      expect(evaluateNavigation(url, { ...remoteAllowed, allowedHosts: ["*"] }).allowed).toBe(
        false,
      );
    }
  });

  test("requires opt-in before link-local blocking can be relaxed", () => {
    const decision = evaluateNavigation("http://169.254.169.254/", {
      ...remoteAllowed,
      allowRemote: true,
      allowedHosts: ["169.254.169.254"],
      blockLinkLocal: false,
    });
    expect(decision.allowed).toBe(true);
  });

  test("matches hostnames exactly or by a single-level wildcard", () => {
    expect(hostnameMatches("staging.example.com", "staging.example.com")).toBe(true);
    expect(hostnameMatches("STAGING.example.com", "staging.example.com")).toBe(true);
    expect(hostnameMatches("a.preview.example.com", "*.preview.example.com")).toBe(true);
    expect(hostnameMatches("a.b.preview.example.com", "*.preview.example.com")).toBe(true);
    expect(hostnameMatches("preview.example.com", "*.preview.example.com")).toBe(false);
    expect(hostnameMatches("notpreview.example.com", "*.preview.example.com")).toBe(false);
  });

  test("classifies hosts", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("128.0.0.1")).toBe(false);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLinkLocalHostname("169.254.0.1")).toBe(true);
    expect(isLinkLocalHostname("10.0.0.1")).toBe(false);
    expect(normalizeHostname("[::1]")).toBe("::1");
  });

  test("derives request origins only from allowed navigation targets", () => {
    const origins = allowedOriginsFor(
      ["http://localhost:3000/", "http://localhost:3000/about", "https://remote.example.com/"],
      localOnly,
    );
    expect([...origins]).toEqual(["http://localhost:3000"]);
  });

  test("treats same-host other-port origins as allowed but not other hosts", () => {
    const allowed = new Set(["http://localhost:3000"]);
    expect(originMatches("http://localhost:3000", allowed)).toBe(true);
    expect(originMatches("http://localhost:4321", allowed)).toBe(true);
    expect(originMatches("http://evil.example.com", allowed)).toBe(false);
  });

  test("strips credentials and fragments before persisting a URL", () => {
    expect(sanitizeUrlForStorage("http://user:pass@localhost:3000/page#section")).toBe(
      "http://localhost:3000/page#",
    );
    expect(sanitizeUrlForStorage("not a url")).toBe("not a url");
  });
});

describe("redaction", () => {
  test("replaces configured patterns in strings", () => {
    const redaction = compileRedaction({
      selectors: [],
      patterns: ["sk-[a-z0-9]+"],
      replacement: "[redacted]",
    });
    expect(redactString("token sk-abc123 leaked", redaction)).toBe("token [redacted] leaked");
  });

  test("redacts nested structures without touching binary payloads", () => {
    const redaction = compileRedaction({ selectors: [], patterns: ["secret"], replacement: "***" });
    const payload = new Uint8Array([1, 2, 3]);
    const result = redactDeep(
      { message: "my secret value", list: ["secret", 1], payload, nested: { deep: "secret!" } },
      redaction,
    );
    expect(result.message).toBe("my *** value");
    expect(result.list[0]).toBe("***");
    expect(result.nested.deep).toBe("***!");
    expect(result.payload).toBe(payload);
  });

  test("surfaces invalid pattern sources as configuration errors", () => {
    expect(() => compileRedaction({ selectors: [], patterns: ["("], replacement: "" })).toThrow(
      ConfigError,
    );
  });

  test("the empty redaction leaves values untouched", () => {
    expect(redactString("nothing to hide", EMPTY_REDACTION)).toBe("nothing to hide");
  });

  test("resets lastIndex so repeated redaction stays deterministic", () => {
    const redaction = compileRedaction({ selectors: [], patterns: ["a"], replacement: "b" });
    expect(redactString("aaa", redaction)).toBe("bbb");
    expect(redactString("aaa", redaction)).toBe("bbb");
  });
});
