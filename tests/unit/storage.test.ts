import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RunStore, StorageError, sha256, toPosix } from "../../src/storage/run-store.js";
import { CREATED_MANIFEST, CREATED_CAPTURE, CREATED_FINDING } from "../helpers/documents.js";

async function makeStore(): Promise<RunStore> {
  const root = await mkdtemp(path.join(tmpdir(), "visual-qa-store-"));
  const store = new RunStore(root);
  await store.ensureRoot();
  return store;
}

describe("run store", () => {
  test("persists artifacts with hashes and POSIX relative paths", async () => {
    const store = await makeStore();
    const data = Buffer.from("fake-png-bytes");
    const artifact = await store.writeArtifact("run_1", {
      captureId: "root__default__mobile",
      kind: "screenshot_viewport",
      fileName: "viewport.png",
      mimeType: "image/png",
      data,
      width: 375,
      height: 812,
    });
    expect(artifact.path).toBe("artifacts/root__default__mobile/viewport.png");
    expect(artifact.sha256).toBe(sha256(data));
    expect(artifact.bytes).toBe(data.byteLength);
    expect((await store.readArtifactFile("run_1", artifact.path)).toString()).toBe(
      "fake-png-bytes",
    );
  });

  test("refuses to read or write outside the run directory", async () => {
    const store = await makeStore();
    expect(() => store.resolveArtifactPath("run_1", "../../etc/passwd")).toThrow(StorageError);
    await expect(store.readArtifactFile("run_1", "../../secret.txt")).rejects.toThrow(StorageError);
  });

  test("refuses run IDs that escape the runs directory", async () => {
    const store = await makeStore();
    expect(() => store.run("../outside")).toThrow(StorageError);
    expect(() => store.run("/outside")).toThrow(StorageError);
    await expect(store.writeManifest({ ...CREATED_MANIFEST, id: "../outside" })).rejects.toThrow(
      StorageError,
    );
  });

  test("does not prune a path named by a forged manifest ID", async () => {
    const store = await makeStore();
    const victimDir = path.join(store.paths.root, "victim");
    await mkdir(victimDir);
    await writeFile(path.join(victimDir, "sentinel"), "keep");
    const forgedDir = path.join(store.paths.runsDir, "run_forged");
    await mkdir(forgedDir);
    await writeFile(
      path.join(forgedDir, "manifest.json"),
      JSON.stringify({
        ...CREATED_MANIFEST,
        id: "../victim",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await store.writeManifest({
      ...CREATED_MANIFEST,
      id: "run_valid",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    expect((await store.listRuns()).map((run) => run.id)).toEqual(["run_valid"]);
    await store.pruneRuns(1);
    expect(await readFile(path.join(victimDir, "sentinel"), "utf8")).toBe("keep");
  });

  test("round-trips manifests, captures and findings", async () => {
    const store = await makeStore();
    await store.writeManifest(CREATED_MANIFEST);
    await store.writeCaptures("run_1", [CREATED_CAPTURE]);
    await store.writeFindings("run_1", [CREATED_FINDING]);

    expect((await store.readManifest("run_1")).id).toBe("run_1");
    expect((await store.readCaptures("run_1"))[0]?.id).toBe("root__default__mobile");
    expect((await store.readFindings("run_1"))[0]?.id).toBe(CREATED_FINDING.id);
    expect((await store.readCapture("run_1", "root__default__mobile"))?.route).toBe("/");
    expect(await store.readCapture("run_1", "missing")).toBeUndefined();
  });

  test("rejects corrupted persisted documents instead of returning partial data", async () => {
    const store = await makeStore();
    await store.ensureRun("run_bad");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.run("run_bad").manifestPath, "{ not json", "utf8");
    await expect(store.readManifest("run_bad")).rejects.toThrow(StorageError);

    await writeFile(store.run("run_bad").manifestPath, JSON.stringify({ id: 1 }), "utf8");
    await expect(store.readManifest("run_bad")).rejects.toThrow();
  });

  test("stores baselines with an auditable index", async () => {
    const store = await makeStore();
    const relative = "root__default__mobile/viewport.png";
    expect(await store.baselineExists(relative)).toBe(false);
    await store.writeBaseline(relative, Buffer.from("baseline"), { runId: "run_1" });
    expect(await store.baselineExists(relative)).toBe(true);
    expect((await store.readBaseline(relative)).toString()).toBe("baseline");

    const index = await store.readBaselineIndex();
    const entries = index.entries as Record<string, { runId: string; sha256: string }>;
    expect(entries[relative]?.runId).toBe("run_1");
    expect(entries[relative]?.sha256).toBe(sha256(Buffer.from("baseline")));
  });

  test("refuses baseline paths outside the baseline directory", async () => {
    const store = await makeStore();
    expect(() => store.resolveBaselinePath("../escape.png")).toThrow(StorageError);
  });

  test("returns an empty finding state before anything was recorded", async () => {
    const store = await makeStore();
    const state = await store.readFindingState();
    expect(state.entries).toEqual([]);
    expect(state.version).toBe(1);
  });

  test("round-trips finding state", async () => {
    const store = await makeStore();
    await store.writeFindingState({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [
        {
          id: CREATED_FINDING.id,
          route: "/",
          scenario: "default",
          viewport: "mobile",
          category: "runtime_error",
          origin: "deterministic_rule",
          ruleId: "runtime:console-error",
          severity: "medium",
          observation: "boom",
          firstSeenRunId: "run_1",
          lastRunId: "run_1",
          status: "open",
          history: [],
        },
      ],
    });
    expect((await store.readFindingState()).entries).toHaveLength(1);
  });

  test("lists and prunes runs while keeping the newest ones", async () => {
    const store = await makeStore();
    for (const [index, id] of ["run_a", "run_b", "run_c"].entries()) {
      await store.writeManifest({
        ...CREATED_MANIFEST,
        id,
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        status: "completed",
      });
    }
    const listed = await store.listRuns();
    expect(listed.map((run) => run.id)).toEqual(["run_c", "run_b", "run_a"]);

    const removed = await store.pruneRuns(2);
    expect(removed).toEqual(["run_a"]);

    await store.writeManifest({ ...CREATED_MANIFEST, id: "run_running", status: "running" });
    const afterPrune = await store.pruneRuns(1);
    expect(afterPrune).not.toContain("run_running");
  });

  test("writes the report into the run directory", async () => {
    const store = await makeStore();
    const relative = await store.writeReport("run_1", "<html></html>");
    expect(relative).toBe("report.html");
    const runDir = store.run("run_1").runDir;
    expect(await readFile(path.join(runDir, "report.html"), "utf8")).toBe("<html></html>");
  });

  test("normalises separators to POSIX", () => {
    expect(toPosix(path.join("a", "b", "c"))).toBe("a/b/c");
  });
});
