import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { checkRepository } from "../src/check.js";

test("caps captured turbo output in quiet mode", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boundaries-check-"));
  const root = join(temp, "repo");
  const bin = join(temp, "bin");
  await mkdir(join(root, "packages/ui"), { recursive: true });
  await mkdir(bin);
  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["packages/ui"],
  });
  await writeJson(join(root, "turbo.json"), {
    boundaries: {
      tags: {
        "type:package": {
          dependencies: {},
        },
      },
    },
  });
  await writeJson(join(root, "packages/ui/package.json"), {
    name: "@acme/ui",
    private: true,
  });
  await writeJson(join(root, "packages/ui/turbo.json"), {
    tags: ["type:package"],
  });
  await writeFile(
    join(bin, "turbo"),
    `#!/usr/bin/env node
async function write(stream, character, total) {
  let remaining = total;
  while (remaining > 0) {
    const chunk = character.repeat(Math.min(4096, remaining));
    remaining -= chunk.length;
    if (!stream.write(chunk)) {
      await new Promise((resolve) => stream.once("drain", resolve));
    }
  }
}
await write(process.stdout, "o", 70000);
await write(process.stderr, "e", 70000);
process.exit(1);
`,
    { mode: 0o755 },
  );

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    const result = await checkRepository({ root, quiet: true });

    assert.equal(result.ok, false);
    assert.equal(result.turbo.stdout.length, 65536);
    assert.equal(result.turbo.stderr.length, 65536);
    assert.equal(result.turbo.stdoutTruncated, true);
    assert.equal(result.turbo.stderrTruncated, true);
  } finally {
    process.env.PATH = originalPath;
  }
});

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
