import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Pass the package.json path to verify");
const { name, version } = JSON.parse(await readFile(manifestPath, "utf8"));
if (typeof name !== "string" || typeof version !== "string") {
  throw new Error("Package name and version are required");
}

// npm ingests a publish asynchronously and says so: "Your package is being
// processed and may take a few minutes to become available." Measured across
// this ecosystem the window runs to five minutes or more, during which the
// registry answers 404 for a version it has already accepted. Tarball size does
// not predict it: a 130 kB package and a 6.9 MB one waited the same. Checking
// once turns that window into a failed release that actually shipped, so poll
// it out.
const TIMEOUT_MS = 15 * 60 * 1000;
const INTERVAL_MS = 15 * 1000;
const deadline = Date.now() + TIMEOUT_MS;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch sends no npm credentials: success proves anonymous access to this exact release.
const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
let published;
for (;;) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.ok) {
    published = await response.json();
    break;
  }
  if (response.status !== 404) {
    throw new Error(`Registry returned ${response.status} for ${name}@${version}`);
  }
  if (Date.now() >= deadline) {
    throw new Error(`${name}@${version} was still 404 after ${TIMEOUT_MS / 60000} minutes`);
  }
  console.log(`Waiting for ${name}@${version} to become available...`);
  await wait(INTERVAL_MS);
}
if (published.name !== name || published.version !== version) {
  throw new Error(`Registry metadata does not match ${name}@${version}`);
}
const consumerRoot = await mkdtemp(join(tmpdir(), "howells-boundaries-published-consumer-"));
try {
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ private: true }));
  // The resolver lags the packument: npm reported ETARGET for a version the
  // registry document already listed. Same window, same treatment.
  for (;;) {
    try {
      execFileSync(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
          `${name}@${version}`,
        ],
        {
          cwd: consumerRoot,
          stdio: "pipe",
        },
      );
      break;
    } catch (error) {
      const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
      if (!output.includes("ETARGET") && !output.includes("notarget")) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`${name}@${version} never became installable`);
      }
      console.log(`Waiting for ${name}@${version} to become installable...`);
      await wait(INTERVAL_MS);
    }
  }
} finally {
  await rm(consumerRoot, { recursive: true, force: true });
}
console.log(`Verified public npm release ${name}@${version}`);
