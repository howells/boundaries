import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../src/cli.js", import.meta.url);

test("prints command help for the boundaries binary", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath.pathname,
    "--help",
  ]);

  assert.match(stdout, /Usage: boundaries \[command\]/);
  assert.match(stdout, /Default command: check/);
  assert.match(stdout, /init/);
  assert.match(stdout, /check/);
  assert.match(stdout, /explain/);
});

test("defaults to check when no command is provided", async () => {
  const root = await createFixtureRepo();
  await execFileAsync(process.execPath, [cliPath.pathname, "init"], {
    cwd: root,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath.pathname, "--no-turbo"],
    { cwd: root }
  );

  assert.match(stdout, /Boundary configuration is valid for 2 workspaces/);
});

test("runs boundaries init from the command line", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-cli-"));
  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["apps/*"],
  });
  await writeJson(join(root, "turbo.json"), {
    tasks: {
      build: {},
    },
  });
  await mkdir(join(root, "apps/web"), { recursive: true });
  await writeJson(join(root, "apps/web/package.json"), {
    name: "@acme/web",
    private: true,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath.pathname, "init"],
    {
      cwd: root,
    }
  );

  assert.match(stdout, /Initialized boundaries for 1 workspace/);

  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf-8")
  );
  assert.equal(packageJson.scripts.boundaries, "boundaries check");
});

test("prints machine-readable help schema", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath.pathname,
    "--schema",
  ]);
  const schema = JSON.parse(stdout);

  assert.equal(schema.success, true);
  assert.equal(schema.data.name, "boundaries");
  assert.deepEqual(
    schema.data.commands.map((command) => command.name),
    ["init", "check", "explain", "help"]
  );
  assert.equal(
    schema.data.commands[0].options.some(
      (option) => option.name === "--dry-run"
    ),
    true
  );
  assert.equal(
    schema.data.commands[1].options.some(
      (option) => option.name === "--profile"
    ),
    true
  );
});

test("prints JSON for init dry-run and does not write files", async () => {
  const root = await createFixtureRepo();

  const beforePackage = await readFile(join(root, "package.json"), "utf-8");
  await assert.rejects(stat(join(root, "apps/web/turbo.json")), {
    code: "ENOENT",
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath.pathname, "init", "--dry-run", "--json"],
    { cwd: root }
  );

  const response = JSON.parse(stdout);
  assert.equal(response.success, true);
  assert.equal(response.data.dryRun, true);
  assert.equal(response.data.workspaces.length, 2);
  assert.equal(
    response.data.plannedWrites.some(
      (write) => write.path === "apps/web/turbo.json"
    ),
    true
  );
  assert.equal(
    await readFile(join(root, "package.json"), "utf-8"),
    beforePackage
  );
  await assert.rejects(stat(join(root, "apps/web/turbo.json")), {
    code: "ENOENT",
  });
});

test("prints structured JSON errors", async () => {
  const { stdout, stderr, code } = await execCli(["nope", "--json"]);

  assert.equal(code, 64);
  assert.equal(stdout, "");
  const response = JSON.parse(stderr);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "UNKNOWN_COMMAND");
  assert.equal(response.error.is_retriable, false);
});

test("prints JSON for check config failures", async () => {
  const root = await createFixtureRepo();
  const { stderr, code } = await execCli(["check", "--no-turbo", "--json"], {
    cwd: root,
  });

  assert.equal(code, 1);
  const response = JSON.parse(stderr);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "ROOT_BOUNDARIES_MISSING");
  assert.equal(response.data.errors[0].file, "turbo.json");
});

test("prints JSON for profile check violations", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-cli-"));
  await mkdir(join(root, "src/shared"), { recursive: true });
  await mkdir(join(root, "src/features/search"), { recursive: true });
  await writeFile(
    join(root, "src/shared/date.js"),
    'import "../features/search/model.js";\n'
  );
  await writeFile(
    join(root, "src/features/search/model.js"),
    "export const model = {};\n"
  );

  const { stderr, code } = await execCli(
    ["check", "--profile", "feature-sliced", "--json"],
    { cwd: root }
  );

  assert.equal(code, 1);
  const response = JSON.parse(stderr);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "PROFILE_BOUNDARY_VIOLATIONS");
  assert.equal(response.data.profile, "feature-sliced");
  assert.equal(response.data.violations.length, 1);
});

test("prints JSON for clean profile checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "boundaries-cli-"));
  await mkdir(join(root, "src/features/search"), { recursive: true });
  await mkdir(join(root, "src/shared"), { recursive: true });
  await writeFile(
    join(root, "src/features/search/model.js"),
    'import "../../shared/date.js";\n'
  );
  await writeFile(
    join(root, "src/shared/date.js"),
    "export const format = () => '';\n"
  );

  const { stdout, code } = await execCli(
    ["check", "--profile=feature-sliced", "--json"],
    { cwd: root }
  );

  assert.equal(code, 0);
  const response = JSON.parse(stdout);
  assert.equal(response.success, true);
  assert.equal(response.data.profile, "feature-sliced");
  assert.equal(response.data.violations.length, 0);
});

test("prints structured JSON errors for unsafe workspace patterns", async () => {
  const temp = await mkdtemp(join(tmpdir(), "boundaries-cli-"));
  const root = join(temp, "repo");
  await mkdir(root, { recursive: true });
  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["../outside/*"],
  });

  const { stderr, code } = await execCli(["init", "--json"], { cwd: root });

  assert.equal(code, 70);
  const response = JSON.parse(stderr);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "UNSAFE_WORKSPACE_PATTERN");
  assert.equal(response.error.is_retriable, false);
});

test("prints JSON for explain decisions", async () => {
  const root = await createFixtureRepo({ includeSecondApp: true });
  await execFileAsync(process.execPath, [cliPath.pathname, "init"], {
    cwd: root,
  });

  const { stdout, code } = await execCli(
    ["explain", "apps/web", "apps/admin", "--json"],
    {
      cwd: root,
    }
  );

  assert.equal(code, 1);
  const response = JSON.parse(stdout);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "BOUNDARY_BLOCKED");
  assert.equal(response.data.allowed, false);
});

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixtureRepo({ includeSecondApp = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "boundaries-cli-"));
  await writeJson(join(root, "package.json"), {
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });
  await writeJson(join(root, "turbo.json"), {
    tasks: {
      build: {},
    },
  });
  await writePackage(root, "apps/web", "@acme/web");
  await writePackage(root, "packages/ui", "@acme/ui");
  if (includeSecondApp) {
    await writePackage(root, "apps/admin", "@acme/admin");
  }
  return root;
}

async function writePackage(root, relativePath, name) {
  await mkdir(join(root, relativePath), { recursive: true });
  await writeJson(join(root, relativePath, "package.json"), {
    name,
    private: true,
  });
}

async function execCli(args, options = {}) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [cliPath.pathname, ...args],
      options
    );
    return { ...result, code: 0 };
  } catch (error) {
    return {
      code: error.code,
      stderr: error.stderr ?? "",
      stdout: error.stdout ?? "",
    };
  }
}
