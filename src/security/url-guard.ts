/**
 * Navigation and request policy.
 *
 * The default posture is localhost-only. Remote navigation requires an explicit
 * opt-in plus an explicit hostname allowlist, and link-local/metadata endpoints
 * stay blocked in every mode.
 */

export interface SecurityPolicy {
  readonly allowRemote: boolean;
  readonly allowedHosts: readonly string[];
  readonly blockRequestsToOtherOrigins: boolean;
  readonly blockLinkLocal: boolean;
}

export type UrlDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
  "metadata.google.internal",
]);

/** Strip the brackets Node keeps around IPv6 hosts in `URL#hostname`. */
export function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (host === "0.0.0.0" || host === "::") {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) {
    return ipv4[0] === 127;
  }
  return false;
}

export function isLinkLocalHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (METADATA_HOSTS.has(host)) {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) {
    const [a, b] = ipv4;
    return a === 169 && b === 254;
  }
  return host.startsWith("fe80:");
}

/** `true` when `hostname` matches an allowlist entry (exact or `*.suffix`). */
export function hostnameMatches(hostname: string, entry: string): boolean {
  const host = normalizeHostname(hostname);
  const pattern = normalizeHostname(entry);
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

export function evaluateNavigation(rawUrl: string, policy: SecurityPolicy): UrlDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: `Unparseable URL: ${rawUrl}` };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      allowed: false,
      reason: `Protocol ${url.protocol} is not allowed; only http and https are permitted.`,
    };
  }

  if (policy.blockLinkLocal && isLinkLocalHostname(url.hostname)) {
    return {
      allowed: false,
      reason: `Link-local or metadata host ${url.hostname} is always blocked.`,
    };
  }

  if (isLoopbackHostname(url.hostname)) {
    return { allowed: true };
  }

  const listed = policy.allowedHosts.some((entry) => hostnameMatches(url.hostname, entry));
  if (!listed) {
    return {
      allowed: false,
      reason: `Host ${url.hostname} is not in security.allowedHosts.`,
    };
  }
  if (!policy.allowRemote) {
    return {
      allowed: false,
      reason: `Remote navigation to ${url.hostname} requires security.allowRemote: true.`,
    };
  }
  return { allowed: true };
}

export function assertNavigationAllowed(rawUrl: string, policy: SecurityPolicy): URL {
  const decision = evaluateNavigation(rawUrl, policy);
  if (!decision.allowed) {
    throw new NavigationBlockedError(rawUrl, decision.reason);
  }
  return new URL(rawUrl);
}

export class NavigationBlockedError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`Navigation to ${url} refused: ${reason}`);
    this.name = "NavigationBlockedError";
    this.url = url;
    this.reason = reason;
  }
}

/**
 * Origins the browser may actually contact while a page is under inspection.
 * Derived from the allowed navigation targets so request interception and
 * navigation policy cannot drift apart.
 */
export function allowedOriginsFor(urls: readonly string[], policy: SecurityPolicy): Set<string> {
  const origins = new Set<string>();
  for (const raw of urls) {
    const decision = evaluateNavigation(raw, policy);
    if (decision.allowed) {
      origins.add(new URL(raw).origin);
    }
  }
  return origins;
}

export function originMatches(origin: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(origin)) {
    return true;
  }
  // A page on a non-default port may still need same-host subresources on
  // another port (for example an asset server). Match the hostname as well.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  for (const candidate of allowed) {
    try {
      if (normalizeHostname(new URL(candidate).hostname) === normalizeHostname(parsed.hostname)) {
        return true;
      }
    } catch {}
  }
  return false;
}

/** Remove credentials from a URL before it is persisted or reviewed. */
export function sanitizeUrlForStorage(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
    }
    url.hash = url.hash.length > 0 ? "#" : "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets as [number, number, number, number];
}
