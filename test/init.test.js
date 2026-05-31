import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { initRepository } from "../src/init.js";

test("initializes a Turborepo workspace with boundary tags and scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-"));

  await writeJson(join(root, "package.json"), {
    private: true,
    scripts: {
      build: "turbo run build",
    },
  });
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n  - packages/*\n  - services/*\n",
  );
  await writeJson(join(root, "turbo.json"), {
    $schema: "https://turbo.build/schema.json",
    tasks: {
      build: {
        dependsOn: ["^build"],
      },
    },
  });

  await writePackage(root, "apps/web", "@acme/web");
  await writePackage(root, "apps/admin", "@acme/admin");
  await writePackage(root, "packages/ui", "@acme/ui");
  await writePackage(root, "services/worker", "@acme/worker");

  const result = await initRepository({ root });

  assert.deepEqual(result.workspaces.map((workspace) => workspace.path), [
    "apps/admin",
    "apps/web",
    "packages/ui",
    "services/worker",
  ]);

  const rootPackageJson = await readJson(join(root, "package.json"));
  assert.equal(rootPackageJson.scripts.boundaries, "boundaries check");
  assert.equal(rootPackageJson.scripts.build, "turbo run build");

  const rootTurboJson = await readJson(join(root, "turbo.json"));
  assert.equal(rootTurboJson.tasks.build.dependsOn[0], "^build");
  assert.deepEqual(rootTurboJson.boundaries.tags["type:app"].dependencies.deny, [
    "type:app",
  ]);

  assert.deepEqual(await readJson(join(root, "apps/web/turbo.json")), {
    extends: ["//"],
    tags: ["type:app", "scope:web", "visibility:internal"],
  });

  assert.deepEqual(await readJson(join(root, "packages/ui/turbo.json")), {
    extends: ["//"],
    tags: ["type:package", "scope:ui", "visibility:internal"],
  });

  assert.deepEqual(await readJson(join(root, "services/worker/turbo.json")), {
    extends: ["//"],
    tags: ["type:package", "scope:worker", "visibility:internal"],
  });
});

test("rejects workspace patterns that resolve outside the repository root", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boundaries-"));
  const root = join(temp, "repo");
  const outsidePackage = join(temp, "outside/pkg");

  await mkdir(root, { recursive: true });
  await mkdir(outsidePackage, { recursive: true });
  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["../outside/*"],
  });
  await writeJson(join(root, "turbo.json"), {
    tasks: {},
  });
  await writeJson(join(outsidePackage, "package.json"), {
    name: "outside-pkg",
    private: true,
  });

  await assert.rejects(
    initRepository({ root }),
    { code: "UNSAFE_WORKSPACE_PATTERN" },
  );
  await assert.rejects(readFile(join(outsidePackage, "turbo.json"), "utf8"), {
    code: "ENOENT",
  });
});

test("rejects workspace symlinks that resolve outside the repository root", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boundaries-"));
  const root = join(temp, "repo");
  const outsidePackage = join(temp, "outside-package");

  await mkdir(join(root, "packages"), { recursive: true });
  await mkdir(outsidePackage, { recursive: true });
  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["packages/link"],
  });
  await writeJson(join(root, "turbo.json"), {
    tasks: {},
  });
  await writeJson(join(outsidePackage, "package.json"), {
    name: "outside-package",
    private: true,
  });
  await symlink(outsidePackage, join(root, "packages/link"), "dir");

  await assert.rejects(
    initRepository({ root }),
    { code: "UNSAFE_WORKSPACE_PATTERN" },
  );
  await assert.rejects(readFile(join(outsidePackage, "turbo.json"), "utf8"), {
    code: "ENOENT",
  });
});

test("discovers exact workspace package paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-"));

  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["packages/ui"],
  });
  await writeJson(join(root, "turbo.json"), {
    tasks: {},
  });
  await writePackage(root, "packages/ui", "@acme/ui");

  const result = await initRepository({ root, dryRun: true });

  assert.deepEqual(result.workspaces.map((workspace) => workspace.path), [
    "packages/ui",
  ]);
  assert.equal(result.plannedWrites.some((write) => write.path === "packages/ui/turbo.json"), true);
});

async function writePackage(root, relativePath, name) {
  const directory = join(root, relativePath);
  await mkdir(directory, { recursive: true });
  await writeJson(join(directory, "package.json"), {
    name,
    private: true,
    version: "0.0.0",
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
}
