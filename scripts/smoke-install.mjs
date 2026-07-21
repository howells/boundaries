import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url);
const temp = await mkdtemp(join(tmpdir(), "boundaries-smoke-"));

try {
  const { stdout: packOutput } = await execFileAsync(
    "npm",
    ["pack", "--pack-destination", temp],
    {
      cwd: root,
    }
  );
  const filename = packOutput
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"));
  if (!filename) {
    throw new Error(
      `Could not find packed tarball in npm pack output:\n${packOutput}`
    );
  }
  const tarball = join(temp, filename);

  await execFileAsync("npm", ["init", "-y"], { cwd: temp });
  await execFileAsync("npm", ["install", tarball, "--ignore-scripts"], {
    cwd: temp,
  });

  const { stdout } = await execFileAsync("npx", ["boundaries", "--help"], {
    cwd: temp,
  });
  if (!stdout.includes("Usage: boundaries [command]")) {
    throw new Error("Installed boundaries binary did not print expected help.");
  }

  process.stdout.write(`Smoke install passed in ${temp}\n`);
} finally {
  await rm(temp, { force: true, recursive: true });
}
