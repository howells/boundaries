import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const validatorSource = await readFile("scripts/validate-skill.mjs", "utf-8");

test("accepts required skill frontmatter fields", async () => {
  const fixture = await createValidatorFixture(`---
name: howells-boundaries
description: Validate package boundaries
---

Run boundaries init, then boundaries check.
`);

  const { stdout } = await execFileAsync(process.execPath, [fixture.script]);

  assert.equal(stdout, "Skill is valid.\n");
});

test("rejects skill frontmatter missing a required field", async () => {
  const fixture = await createValidatorFixture(`---
description: Validate package boundaries
---

Run boundaries init, then boundaries check.
`);

  await assert.rejects(
    execFileAsync(process.execPath, [fixture.script]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /frontmatter is missing name:/);
      return true;
    }
  );
});

async function createValidatorFixture(skill) {
  const root = await mkdtemp(join(tmpdir(), "boundaries-skill-validator-"));
  const script = join(root, "scripts/validate-skill.mjs");
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "skills/howells-boundaries"), { recursive: true });
  await writeFile(script, validatorSource);
  await writeFile(join(root, "skills/howells-boundaries/SKILL.md"), skill);
  return { root, script };
}
