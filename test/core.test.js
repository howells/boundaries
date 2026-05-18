import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRootBoundaryConfig,
  createPackageTurboConfig,
  evaluateDependency,
  inferTagsForWorkspace,
} from "../src/core.js";

test("infers conservative tags from common Turborepo workspace paths", () => {
  assert.deepEqual(inferTagsForWorkspace({ path: "apps/web", name: "@acme/web" }), [
    "type:app",
    "scope:web",
    "visibility:internal",
  ]);

  assert.deepEqual(inferTagsForWorkspace({ path: "packages/ui", name: "@acme/ui" }), [
    "type:package",
    "scope:ui",
    "visibility:internal",
  ]);

  assert.deepEqual(inferTagsForWorkspace({ path: "tooling/lint", name: "@acme/lint" }), [
    "type:tooling",
    "scope:lint",
    "visibility:internal",
  ]);
});

test("creates package turbo.json content without replacing existing tasks", () => {
  const current = {
    extends: ["//"],
    tasks: {
      build: {
        outputs: ["dist/**"],
      },
    },
  };

  assert.deepEqual(
    createPackageTurboConfig(current, ["type:package", "scope:ui", "visibility:internal"]),
    {
      extends: ["//"],
      tags: ["type:package", "scope:ui", "visibility:internal"],
      tasks: {
        build: {
          outputs: ["dist/**"],
        },
      },
    },
  );
});

test("adds default root boundary policy while preserving unrelated turbo config", () => {
  const current = {
    $schema: "https://turbo.build/schema.json",
    tasks: {
      build: {
        dependsOn: ["^build"],
      },
    },
  };

  assert.deepEqual(applyRootBoundaryConfig(current), {
    $schema: "https://turbo.build/schema.json",
    tasks: {
      build: {
        dependsOn: ["^build"],
      },
    },
    boundaries: {
      tags: {
        "type:app": {
          dependencies: {
            deny: ["type:app"],
          },
        },
        "type:package": {
          dependencies: {
            deny: ["type:app"],
          },
        },
        "type:tooling": {
          dependencies: {
            deny: ["type:app"],
          },
        },
      },
    },
  });
});

test("evaluates direct package dependency decisions from tags", () => {
  const rootConfig = applyRootBoundaryConfig({});

  assert.equal(
    evaluateDependency({
      rootConfig,
      fromTags: ["type:app", "scope:web", "visibility:internal"],
      toTags: ["type:app", "scope:docs", "visibility:internal"],
    }).allowed,
    false,
  );

  assert.equal(
    evaluateDependency({
      rootConfig,
      fromTags: ["type:app", "scope:web", "visibility:internal"],
      toTags: ["type:package", "scope:ui", "visibility:internal"],
    }).allowed,
    true,
  );

  assert.equal(
    evaluateDependency({
      rootConfig,
      fromTags: ["visibility:public", "type:package", "scope:sdk"],
      toTags: ["visibility:internal", "type:package", "scope:utils"],
    }).allowed,
    true,
  );
});
