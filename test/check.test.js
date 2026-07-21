import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { checkRepository } from "../src/check.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../src/cli.js", import.meta.url);

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
    { mode: 0o755 }
  );
  await execFileAsync("git", ["init"], { cwd: root });

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    const result = await checkRepository({ quiet: true, root });

    assert.equal(result.ok, false);
    assert.equal(result.turbo.stdout.length, 65_536);
    assert.equal(result.turbo.stderr.length, 65_536);
    assert.equal(result.turbo.stdoutTruncated, true);
    assert.equal(result.turbo.stderrTruncated, true);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("runs turbo in a filtered mirror without mutating ignored directories", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boundaries-ignored-"));
  const root = join(temp, "repo");
  const bin = join(temp, "bin");
  await mkdir(join(root, "packages/ui/.generated"), { recursive: true });
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
  await writeFile(join(root, ".gitignore"), ".generated/\n");
  await writeFile(
    join(root, "packages/ui/.generated/entry.js"),
    "import 'missing-package';\n"
  );
  await writeFile(
    join(bin, "turbo"),
    `#!/usr/bin/env node
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

try {
  if (resolve(".") === resolve(process.env.BOUNDARIES_TEST_ORIGINAL_ROOT)) {
    throw new Error("turbo ran in the original repository");
  }
  await access(
    join(
      process.env.BOUNDARIES_TEST_ORIGINAL_ROOT,
      "packages/ui/.generated/entry.js"
    )
  );
} catch (error) {
  process.stderr.write(\`original generated directory was mutated: \${error.message}\\n\`);
  process.exit(1);
}

try {
  await access("packages/ui/.generated");
  process.stderr.write("ignored generated directory was visible to turbo\\n");
  process.exit(1);
} catch {
  process.stdout.write("generated directory filtered from mirror\\n");
  process.exit(0);
}
`,
    { mode: 0o755 }
  );

  await execFileAsync("git", ["init"], { cwd: root });

  const originalPath = process.env.PATH;
  const originalTestRoot = process.env.BOUNDARIES_TEST_ORIGINAL_ROOT;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  process.env.BOUNDARIES_TEST_ORIGINAL_ROOT = root;
  try {
    const result = await checkRepository({ quiet: true, root });

    assert.equal(result.ok, true);
    assert.equal(
      result.turbo.stdout.includes("generated directory filtered from mirror"),
      true
    );
    assert.equal(
      await readFile(join(root, "packages/ui/.generated/entry.js"), "utf-8"),
      "import 'missing-package';\n"
    );
  } finally {
    process.env.PATH = originalPath;
    if (originalTestRoot === undefined) {
      delete process.env.BOUNDARIES_TEST_ORIGINAL_ROOT;
    } else {
      process.env.BOUNDARIES_TEST_ORIGINAL_ROOT = originalTestRoot;
    }
  }
});

test("treats turbo termination by signal as a failed check", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX signal semantics are not available on Windows.");
    return;
  }

  const temp = await mkdtemp(join(tmpdir(), "boundaries-signal-"));
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
process.kill(process.pid, "SIGTERM");
`,
    { mode: 0o755 }
  );
  await execFileAsync("git", ["init"], { cwd: root });

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    const result = await checkRepository({ quiet: true, root });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.turbo.signal, "SIGTERM");
    assert.equal(result.turbo.error.code, "TURBO_BOUNDARIES_FAILED");
  } finally {
    process.env.PATH = originalPath;
  }
});

test("filters ignored root files, directory symlinks, caches, and special files", async (context) => {
  if (process.platform === "win32") {
    context.skip(
      "Unix sockets and directory symlinks require POSIX semantics."
    );
    return;
  }

  const { bin, root } = await createValidBoundaryRepo(
    "boundaries-root-ignore-"
  );
  const outside = join(root, "../ignored-target");
  await mkdir(join(root, "packages/ui/.generated"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, "cache.bin"), "ignored cache\n");
  await writeFile(join(outside, "secret.txt"), "outside\n");
  await symlink(outside, join(root, "ignored-link"), "dir");
  await writeFile(
    join(root, ".gitignore"),
    ".generated/\nruntime/\ncache.bin\nignored-link\n"
  );
  await writeTurbo(
    bin,
    `import { access } from "node:fs/promises";

for (const path of ["runtime", "cache.bin", "ignored-link", "packages/ui/.generated"]) {
  try {
    await access(path);
    process.stderr.write(\`ignored path was copied: \${path}\\n\`);
    process.exit(1);
  } catch {}
}
process.stdout.write("all ignored paths filtered\\n");
`
  );
  await execFileAsync("git", ["init"], { cwd: root });

  const socketPath = join(root, "runtime/service.sock");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    const result = await checkRepository({ quiet: true, root });

    assert.equal(result.ok, true);
    assert.match(result.turbo.stdout, /all ignored paths filtered/);
  } finally {
    process.env.PATH = originalPath;
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});

test("materializes included internal symlinks without linking to the original tree", async (context) => {
  if (process.platform === "win32") {
    context.skip("Directory symlinks require elevated privileges on Windows.");
    return;
  }

  const { bin, root } = await createValidBoundaryRepo("boundaries-safe-link-");
  const shared = join(root, "shared");
  await mkdir(join(root, "packages/ui/.generated"), { recursive: true });
  await mkdir(shared);
  await writeFile(join(root, ".gitignore"), ".generated/\n");
  await writeFile(join(shared, "value.txt"), "from shared\n");
  await symlink(shared, join(root, "packages/ui/linked-shared"), "dir");
  await writeTurbo(
    bin,
    `import { lstat, readFile, writeFile } from "node:fs/promises";

const linked = await lstat("packages/ui/linked-shared");
if (linked.isSymbolicLink()) {
  process.stderr.write("internal symlink still points to original tree\\n");
  process.exit(1);
}
if ((await readFile("packages/ui/linked-shared/value.txt", "utf-8")) !== "from shared\\n") {
  process.exit(1);
}
await writeFile("packages/ui/linked-shared/mirror-only.txt", "mirror\\n");
`
  );
  await execFileAsync("git", ["init"], { cwd: root });

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    const result = await checkRepository({ quiet: true, root });

    assert.equal(result.ok, true);
    await assert.rejects(readFile(join(shared, "mirror-only.txt")), {
      code: "ENOENT",
    });
  } finally {
    process.env.PATH = originalPath;
  }
});

test("rejects included symlinks whose targets escape the repository", async (context) => {
  if (process.platform === "win32") {
    context.skip("Directory symlinks require elevated privileges on Windows.");
    return;
  }

  const { bin, root } = await createValidBoundaryRepo(
    "boundaries-escape-link-"
  );
  const outside = join(root, "../outside-link-target");
  await mkdir(join(root, "packages/ui/.generated"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, ".gitignore"), ".generated/\n");
  await symlink(outside, join(root, "packages/ui/external"), "dir");
  await writeTurbo(bin, "process.exit(0);\n");
  await execFileAsync("git", ["init"], { cwd: root });

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    await assert.rejects(checkRepository({ quiet: true, root }), {
      code: "UNSAFE_MIRROR_SYMLINK",
    });
  } finally {
    process.env.PATH = originalPath;
  }
});

test("keeps the mirror outside the repository when TMPDIR is repo-local", async () => {
  const { bin, root } = await createValidBoundaryRepo("boundaries-local-tmp-");
  const localTmp = join(root, "local-tmp");
  await mkdir(join(root, "packages/ui/.generated"), { recursive: true });
  await mkdir(localTmp);
  await writeFile(join(root, ".gitignore"), ".generated/\nlocal-tmp/\n");
  await writeTurbo(
    bin,
    `if (process.cwd().startsWith(process.env.BOUNDARIES_TEST_ORIGINAL_ROOT)) {
  process.stderr.write("mirror was created inside source repository\\n");
  process.exit(1);
}
`
  );
  await execFileAsync("git", ["init"], { cwd: root });

  const originalPath = process.env.PATH;
  const originalTmpdir = process.env.TMPDIR;
  const originalTestRoot = process.env.BOUNDARIES_TEST_ORIGINAL_ROOT;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  process.env.TMPDIR = localTmp;
  process.env.BOUNDARIES_TEST_ORIGINAL_ROOT = root;
  try {
    const result = await checkRepository({ quiet: true, root });
    assert.equal(result.ok, true);
  } finally {
    process.env.PATH = originalPath;
    if (originalTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = originalTmpdir;
    }
    if (originalTestRoot === undefined) {
      delete process.env.BOUNDARIES_TEST_ORIGINAL_ROOT;
    } else {
      process.env.BOUNDARIES_TEST_ORIGINAL_ROOT = originalTestRoot;
    }
  }
});

test("fails closed when Git ignore discovery fails", async () => {
  const { bin, root } = await createValidBoundaryRepo("boundaries-git-fail-");
  await writeFile(
    join(bin, "git"),
    `#!/usr/bin/env node
process.stderr.write("simulated git failure\\n");
process.exit(2);
`,
    { mode: 0o755 }
  );
  await writeTurbo(bin, "process.exit(0);\n");

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  try {
    await assert.rejects(checkRepository({ quiet: true, root }), (error) => {
      assert.equal(error.code, "GIT_IGNORE_DISCOVERY_FAILED");
      assert.match(error.message, /simulated git failure/);
      return true;
    });
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath.pathname, "check", "--json"], {
        cwd: root,
        env: process.env,
      }),
      (error) => {
        assert.equal(error.code, 70);
        const response = JSON.parse(error.stderr);
        assert.equal(response.error.code, "GIT_IGNORE_DISCOVERY_FAILED");
        assert.match(response.error.message, /simulated git failure/);
        return true;
      }
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("includes Turbo termination signals in CLI JSON", async (context) => {
  if (process.platform === "win32") {
    context.skip("POSIX signal semantics are not available on Windows.");
    return;
  }

  const { bin, root } = await createValidBoundaryRepo(
    "boundaries-json-signal-"
  );
  await writeTurbo(bin, 'process.kill(process.pid, "SIGTERM");\n');
  await execFileAsync("git", ["init"], { cwd: root });

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath.pathname, "check", "--json"], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    }),
    (error) => {
      assert.equal(error.code, 1);
      const response = JSON.parse(error.stderr);
      assert.equal(response.data.turbo.signal, "SIGTERM");
      return true;
    }
  );
});

async function createValidBoundaryRepo(prefix) {
  const temp = await mkdtemp(join(tmpdir(), prefix));
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
  return { bin, root, temp };
}

async function writeTurbo(bin, source) {
  await writeFile(join(bin, "turbo"), `#!/usr/bin/env node\n${source}`, {
    mode: 0o755,
  });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
