import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkProfile } from "../src/profile-check.js";

test("feature-sliced profile blocks lower layers importing higher layers", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-profile-"));
  await writeProjectFile(
    root,
    "src/shared/date.js",
    'import "../features/search/model.js";\n'
  );
  await writeProjectFile(
    root,
    "src/features/search/model.js",
    "export const model = {};\n"
  );

  const result = await checkProfile({ profile: "feature-sliced", root });

  assert.equal(result.ok, false);
  assert.equal(result.profile, "feature-sliced");
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].fromLayer, "shared");
  assert.equal(result.violations[0].toLayer, "features");
});

test("feature-sliced profile allows higher layers importing lower layers", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-profile-"));
  await writeProjectFile(
    root,
    "src/features/search/model.js",
    'import "../../shared/date.js";\n'
  );
  await writeProjectFile(
    root,
    "src/shared/date.js",
    "export const format = () => '';\n"
  );

  const result = await checkProfile({ profile: "feature-sliced", root });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("clean-node profile keeps domain independent from adapters", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-profile-"));
  await writeProjectFile(
    root,
    "src/domain/user.js",
    'import "../adapters/http.js";\n'
  );
  await writeProjectFile(
    root,
    "src/adapters/http.js",
    "export const handler = () => {};\n"
  );

  const result = await checkProfile({ profile: "clean-node", root });

  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].fromLayer, "domain");
  assert.equal(result.violations[0].toLayer, "adapters");
});

async function writeProjectFile(root, relativePath, contents) {
  const filePath = join(root, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, contents);
}
