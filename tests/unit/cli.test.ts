import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgs, runCli } from "../../src/cli/main.js";

function capture(): {
  output: string[];
  errors: string[];
  io: { stdout: (text: string) => void; stderr: (text: string) => void };
} {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    io: {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text),
    },
  };
}

describe("argument parsing", () => {
  test("separates the command, repeated flags and positionals", () => {
    const args = parseArgs([
      "inspect",
      "--route",
      "/",
      "--route",
      "/about",
      "--viewport=mobile",
      "extra",
    ]);
    expect(args.command).toBe("inspect");
    expect(args.flags.get("route")).toEqual(["/", "/about"]);
    expect(args.flags.get("viewport")).toEqual(["mobile"]);
    expect(args.positionals).toEqual(["extra"]);
  });

  test("treats a flag without a value as a boolean marker", () => {
    const args = parseArgs(["inspect", "--json", "--route", "/"]);
    expect(args.flags.get("json")).toEqual(["true"]);
    expect(args.flags.get("route")).toEqual(["/"]);
  });

  test("keeps values that contain equals signs", () => {
    const args = parseArgs(["inspect", "--brief=dark mode=yes"]);
    expect(args.flags.get("brief")).toEqual(["dark mode=yes"]);
  });
});

describe("CLI commands", () => {
  test("prints help without a command and succeeds", async () => {
    const { output, io } = capture();
    const code = await runCli([], io);
    expect(code).toBe(0);
    expect(output.join("\n")).toContain("visual-qa-mcp <command>");
    expect(output.join("\n")).toContain("mcp");
    expect(output.join("\n")).toContain("approve-baseline");
  });

  test("prints the version", async () => {
    const { output, io } = capture();
    expect(await runCli(["--version"], io)).toBe(0);
    expect(output.join("\n")).toContain("visual-qa-mcp");
  });

  test("rejects unknown commands with usage exit code", async () => {
    const { errors, io } = capture();
    expect(await runCli(["frobnicate"], io)).toBe(2);
    expect(errors.join("\n")).toContain("Unknown command");
  });

  test("fails with an actionable message when no configuration exists", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-cli-empty-"));
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { errors, io } = capture();
      const code = await runCli(["validate-config"], io);
      expect(code).toBe(2);
      expect(errors.join("\n")).toContain("No visual QA configuration found");
    } finally {
      process.chdir(previous);
    }
  });

  test("keeps non-mcp commands strict without a configuration", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-cli-strict-"));
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { errors, io } = capture();
      expect(await runCli(["inspect"], io)).toBe(2);
      expect(errors.join("\n")).toContain("No visual QA configuration found");
    } finally {
      process.chdir(previous);
    }
  });

  test("keeps an explicitly named missing configuration strict", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-cli-explicit-"));
    const previous = process.cwd();
    process.chdir(directory);
    try {
      const { errors, io } = capture();
      const code = await runCli(["validate-config", "--config", "missing.json"], io);
      expect(code).toBe(2);
      expect(errors.join("\n")).toContain("Cannot read configuration");
    } finally {
      process.chdir(previous);
    }
  });

  test("validates a configuration and reports routes and viewports", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-cli-"));
    const configPath = path.join(directory, "visual-qa.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        baseUrl: "http://localhost:3000",
        routes: [{ path: "/" }, { path: "/about" }],
      }),
      "utf8",
    );
    const { output, io } = capture();
    expect(await runCli(["validate-config", "--config", configPath, "--json"], io)).toBe(0);
    const parsed = JSON.parse(output.join("\n")) as {
      valid: boolean;
      routes: string[];
      viewports: string[];
    };
    expect(parsed.valid).toBe(true);
    expect(parsed.routes).toEqual(["/", "/about"]);
    expect(parsed.viewports).toEqual(["mobile", "tablet", "desktop"]);
  });

  test("requires finding IDs for recheck", async () => {
    const { errors, io } = capture();
    const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-cli-recheck-"));
    const configPath = path.join(directory, "visual-qa.config.json");
    await writeFile(
      configPath,
      JSON.stringify({ baseUrl: "http://localhost:3000", routes: [{ path: "/" }] }),
      "utf8",
    );
    const code = await runCli(["recheck", "--config", configPath], io);
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("--findings");
  });
});
