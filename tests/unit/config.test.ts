import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ConfigError,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  summarizeConfig,
} from "../../src/config/load.js";
import { DEFAULT_VIEWPORTS } from "../../src/config/schema.js";

const minimal = { baseUrl: "http://localhost:3000", routes: [{ path: "/" }] };

describe("configuration schema", () => {
  test("applies the documented default viewport matrix", () => {
    const config = parseConfig(minimal);
    expect(
      config.viewports.map((viewport) => `${viewport.name}:${viewport.width}x${viewport.height}`),
    ).toEqual(["mobile:375x812", "tablet:768x1024", "desktop:1440x900"]);
    expect(config.viewports).toHaveLength(DEFAULT_VIEWPORTS.length);
    expect(config.security.allowRemote).toBe(false);
    expect(config.security.blockRequestsToOtherOrigins).toBe(true);
    expect(config.capture.fullPage).toBe(true);
    expect(config.vision.adapter).toBe("none");
    expect(config.vision.allowScreenshots).toBe(false);
    expect(config.storage.root).toBe(".visual-qa");
  });

  test("gives every route an explicit default scenario", () => {
    const config = parseConfig(minimal);
    expect(config.routes[0]?.scenarios).toEqual([]);
  });

  test("rejects a configuration without a target", () => {
    expect(() => parseConfig({ routes: [{ path: "/" }] })).toThrow(ConfigError);
    try {
      parseConfig({ routes: [{ path: "/" }] });
    } catch (error) {
      expect((error as ConfigError).issues.join("\n")).toContain("baseUrl or preview.command");
    }
  });

  test("requires explicit hosts when remote navigation is enabled", () => {
    try {
      parseConfig({
        ...minimal,
        security: { allowRemote: true },
      });
      throw new Error("expected a ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues.join("\n")).toContain("allowedHosts");
    }
  });

  test("rejects unknown top-level sections so typos cannot be ignored", () => {
    expect(() => parseConfig({ ...minimal, viewport: [] })).toThrow(ConfigError);
  });

  test("rejects duplicate viewport and scenario names", () => {
    expect(() =>
      parseConfig({
        ...minimal,
        viewports: [
          { name: "mobile", width: 375, height: 812 },
          { name: "mobile", width: 414, height: 896 },
        ],
      }),
    ).toThrow(ConfigError);

    expect(() =>
      parseConfig({
        ...minimal,
        routes: [
          {
            path: "/",
            scenarios: [{ name: "dialog" }, { name: "dialog" }],
          },
        ],
      }),
    ).toThrow(ConfigError);
  });

  test("rejects duplicate viewport names but keeps distinct ones", () => {
    const config = parseConfig({
      ...minimal,
      viewports: [
        { name: "small", width: 375, height: 812 },
        { name: "large", width: 1920, height: 1080, isMobile: false },
      ],
    });
    expect(config.viewports.map((viewport) => viewport.name)).toEqual(["small", "large"]);
  });

  test("summarizes the configuration without leaking redaction patterns", () => {
    const config = parseConfig({
      ...minimal,
      redaction: { selectors: ["#secret"], patterns: ["token=\\w+"] },
    });
    const summary = summarizeConfig(config);
    expect(JSON.stringify(summary)).not.toContain("token=");
    expect(summary.redaction).toEqual({ selectors: ["#secret"], patternCount: 1 });
  });
});

describe("configuration loading", () => {
  test("discovers the default config file in a project directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-config-"));
    await writeFile(
      path.join(directory, "visual-qa.config.json"),
      JSON.stringify({ ...minimal, name: "discovered" }),
      "utf8",
    );
    const loaded = await loadConfig(undefined, directory);
    expect(loaded.config.name).toBe("discovered");
    expect(loaded.path).toBe(path.join(directory, "visual-qa.config.json"));
  });

  test("discovers the .visual-qa.config.json alternative", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-config-alt-"));
    await writeFile(
      path.join(directory, ".visual-qa.config.json"),
      JSON.stringify({ ...minimal, name: "alternate" }),
      "utf8",
    );
    const loaded = await loadConfig(undefined, directory);
    expect(loaded.config.name).toBe("alternate");
    expect(loaded.path).toBe(path.join(directory, ".visual-qa.config.json"));
  });

  test("prefers visual-qa.config.json over the alternatives", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-config-order-"));
    await writeFile(
      path.join(directory, "visual-qa.config.json"),
      JSON.stringify({ ...minimal, name: "primary" }),
      "utf8",
    );
    await writeFile(
      path.join(directory, ".visual-qa.config.json"),
      JSON.stringify({ ...minimal, name: "alternate" }),
      "utf8",
    );
    const loaded = await loadConfig(undefined, directory);
    expect(loaded.config.name).toBe("primary");
  });

  test("fails with an actionable message when no configuration exists", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-config-empty-"));
    await expect(resolveConfigPath(undefined, directory)).rejects.toThrow(
      /No visual QA configuration found/,
    );
  });

  test("reports JSON syntax errors and schema violations separately", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-config-bad-"));
    const brokenJson = path.join(directory, "broken.json");
    await writeFile(brokenJson, "{ not json", "utf8");
    await expect(loadConfig(brokenJson, directory)).rejects.toThrow(/not valid JSON/);

    const invalid = path.join(directory, "invalid.json");
    await writeFile(invalid, JSON.stringify({ routes: [] }), "utf8");
    await expect(loadConfig(invalid, directory)).rejects.toThrow(ConfigError);
  });
});
