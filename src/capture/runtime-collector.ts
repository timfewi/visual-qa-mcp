import type { Page } from "playwright";

import type { RuntimeEvent } from "../domain/schema.js";
import { redactString, type CompiledRedaction } from "../security/redact.js";
import { sanitizeUrlForStorage } from "../security/url-guard.js";

const MAX_EVENTS = 200;

/** Collects console messages, page errors, failed requests and error responses. */
export class RuntimeCollector {
  private readonly events: RuntimeEvent[] = [];

  private readonly redaction: CompiledRedaction;

  constructor(redaction: CompiledRedaction) {
    this.redaction = redaction;
  }

  attach(page: Page): void {
    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") {
        return;
      }
      this.push({
        kind: type === "error" ? "console_error" : "console_warning",
        message: this.clean(message.text()),
        at: new Date().toISOString(),
      });
    });

    page.on("pageerror", (error) => {
      this.push({
        kind: "page_error",
        message: this.clean(error.stack ?? error.message),
        at: new Date().toISOString(),
      });
    });

    page.on("requestfailed", (request) => {
      this.push({
        kind: "request_failed",
        message: this.clean(request.failure()?.errorText ?? "request failed"),
        url: sanitizeUrlForStorage(request.url()),
        at: new Date().toISOString(),
      });
    });

    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) {
        return;
      }
      this.push({
        kind: "response_error",
        message: `HTTP ${status}`,
        url: sanitizeUrlForStorage(response.url()),
        status,
        at: new Date().toISOString(),
      });
    });
  }

  /** A snapshot of everything collected so far. */
  snapshot(): RuntimeEvent[] {
    return [...this.events];
  }

  private push(event: RuntimeEvent): void {
    if (this.events.length >= MAX_EVENTS) {
      return;
    }
    this.events.push({ ...event, message: this.clean(event.message) });
  }

  private clean(value: string): string {
    return redactString(value, this.redaction).replace(/\s+/g, " ").trim().slice(0, 1_000);
  }
}
