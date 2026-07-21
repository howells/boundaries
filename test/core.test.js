import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRootBoundaryConfig,
  createPackageTurboConfig,
  evaluateDependency,
  inferTagsForWorkspace,
} from "../src/core.js";

test("infers conservative tags from common Turborepo workspace paths", () => {
  assert.deepEqual(
    inferTagsForWorkspace({ name: "@acme/web", path: "apps/web" }),
    ["type:app", "scope:web", "visibility:internal"]
  );

  assert.deepEqual(
    inferTagsForWorkspace({ name: "@acme/ui", path: "packages/ui" }),
    ["type:package", "scope:ui", "visibility:internal"]
  );

  assert.deepEqual(
    inferTagsForWorkspace({ name: "@acme/lint", path: "tooling/lint" }),
    ["type:tooling", "scope:lint", "visibility:internal"]
  );
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
    createPackageTurboConfig(current, [
      "type:package",
      "scope:ui",
      "visibility:internal",
    ]),
    {
      extends: ["//"],
      tags: ["type:package", "scope:ui", "visibility:internal"],
      tasks: {
        build: {
          outputs: ["dist/**"],
        },
      },
    }
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
    tasks: {
      build: {
        dependsOn: ["^build"],
      },
    },
  });
});

test("evaluates direct package dependency decisions from tags", () => {
  const rootConfig = applyRootBoundaryConfig({});

  assert.equal(
    evaluateDependency({
      fromTags: ["type:app", "scope:web", "visibility:internal"],
      rootConfig,
      toTags: ["type:app", "scope:docs", "visibility:internal"],
    }).allowed,
    false
  );

  assert.equal(
    evaluateDependency({
      fromTags: ["type:app", "scope:web", "visibility:internal"],
      rootConfig,
      toTags: ["type:package", "scope:ui", "visibility:internal"],
    }).allowed,
    true
  );

  assert.equal(
    evaluateDependency({
      fromTags: ["visibility:public", "type:package", "scope:sdk"],
      rootConfig,
      toTags: ["visibility:internal", "type:package", "scope:utils"],
    }).allowed,
    true
  );
});
