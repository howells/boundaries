import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";

import { discoverWorkspaces } from "./init.js";

const OUTPUT_CAPTURE_LIMIT = 64 * 1024;
const MIRROR_SKIP_DIRECTORY_NAMES = new Set([".git", ".turbo", "node_modules"]);

export async function checkRepository({
  root = process.cwd(),
  runTurbo = true,
  stdout = process.stdout,
  stderr = process.stderr,
  quiet = false,
} = {}) {
  const rootPackageJson = await readJson(join(root, "package.json"));
  const rootTurboJson = await readJson(join(root, "turbo.json"), {});
  const workspaces = await discoverWorkspaces(root, rootPackageJson);
  const errors = await validateBoundarySetup(root, rootTurboJson, workspaces);

  if (errors.length > 0) {
    if (!quiet) {
      for (const error of errors) {
        stderr.write(`boundaries: ${error.message}\n`);
      }
    }
    return { errors, exitCode: 1, ok: false };
  }

  if (!runTurbo) {
    if (!quiet) {
      stdout.write(
        `Boundary configuration is valid for ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}.\n`
      );
    }
    return { errors: [], exitCode: 0, ok: true, workspaces };
  }

  const turboResult = await withFilteredRepositoryMirror(
    { root },
    (turboRoot) => runTurboBoundaries({ quiet, root: turboRoot })
  );
  const turboExitCode = turboResult.exitCode;
  return {
    errors: turboExitCode === 0 ? [] : [turboResult.error],
    exitCode: turboExitCode,
    ok: turboExitCode === 0,
    turbo: turboResult,
    workspaces,
  };
}

async function validateBoundarySetup(root, rootTurboJson, workspaces) {
  const errors = [];

  if (!rootTurboJson.boundaries?.tags) {
    errors.push({
      code: "ROOT_BOUNDARIES_MISSING",
      file: "turbo.json",
      is_retriable: false,
      message:
        "root turbo.json is missing boundaries.tags; run `boundaries init`.",
      suggestions: ["Run `boundaries init`."],
    });
  }

  for (const workspace of workspaces) {
    const packageTurboJson = await readJson(
      join(root, workspace.path, "turbo.json"),
      {}
    );
    if (
      !Array.isArray(packageTurboJson.tags) ||
      packageTurboJson.tags.length === 0
    ) {
      errors.push({
        code: "PACKAGE_TAGS_MISSING",
        file: `${workspace.path}/turbo.json`,
        is_retriable: false,
        message: `${workspace.path}/turbo.json is missing package boundary tags.`,
        suggestions: ["Run `boundaries init`."],
      });
    }
  }

  return errors;
}

async function withFilteredRepositoryMirror({ root }, callback) {
  const ignoredPaths = await listGitIgnoredPaths(root);
  if (ignoredPaths.length === 0) {
    return callback(root);
  }

  const resolvedRoot = await realpath(root);
  const tempRoot = await createExternalTempRoot(resolvedRoot);
  const mirrorRoot = join(tempRoot, "repository");
  try {
    await cp(root, mirrorRoot, {
      dereference: true,
      filter: (sourcePath) =>
        shouldCopyToMirror({
          ignoredPaths,
          resolvedRoot,
          root,
          sourcePath,
        }),
      recursive: true,
    });
    return await callback(mirrorRoot);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function createExternalTempRoot(resolvedRoot) {
  const requestedTempBase = await realpath(tmpdir());
  const tempBase = isPathWithin(resolvedRoot, requestedTempBase)
    ? dirname(resolvedRoot)
    : requestedTempBase;
  const tempRoot = await mkdtemp(join(tempBase, "boundaries-check-"));
  const resolvedTempRoot = await realpath(tempRoot);

  if (isPathWithin(resolvedRoot, resolvedTempRoot)) {
    await rm(tempRoot, { force: true, recursive: true });
    const error = new Error(
      "could not create a temporary boundary-check mirror outside the repository."
    );
    error.code = "UNSAFE_MIRROR_TEMP_ROOT";
    error.is_retriable = false;
    error.suggestions = [
      "Set TMPDIR to a writable directory outside the repository.",
    ];
    throw error;
  }

  return tempRoot;
}

async function shouldCopyToMirror({
  ignoredPaths,
  resolvedRoot,
  root,
  sourcePath,
}) {
  const relativePath = normalizeRelativePath(relative(root, sourcePath));
  if (!relativePath) {
    return true;
  }

  if (
    MIRROR_SKIP_DIRECTORY_NAMES.has(basename(sourcePath)) ||
    matchesIgnoredPath(relativePath, ignoredPaths)
  ) {
    return false;
  }

  const stats = await lstat(sourcePath);
  if (!stats.isDirectory() && !stats.isFile() && !stats.isSymbolicLink()) {
    return false;
  }

  let resolvedSource;
  try {
    resolvedSource = await realpath(sourcePath);
  } catch (cause) {
    if (!stats.isSymbolicLink()) {
      throw cause;
    }
    throw unsafeSymlinkError(relativePath, cause);
  }

  if (!isPathWithin(resolvedRoot, resolvedSource)) {
    throw unsafeSymlinkError(relativePath);
  }

  const resolvedRelativePath = normalizeRelativePath(
    relative(resolvedRoot, resolvedSource)
  );
  if (matchesIgnoredPath(resolvedRelativePath, ignoredPaths)) {
    return false;
  }

  if (
    stats.isSymbolicLink() &&
    isPathWithin(resolvedSource, resolvePath(sourcePath))
  ) {
    throw unsafeSymlinkError(relativePath);
  }

  return true;
}

function unsafeSymlinkError(relativePath, cause) {
  const error = new Error(
    `cannot safely mirror symlink ${relativePath}; its target must resolve inside the repository without creating a copy cycle.`,
    cause ? { cause } : undefined
  );
  error.code = "UNSAFE_MIRROR_SYMLINK";
  error.is_retriable = false;
  error.suggestions = [
    "Replace the symlink with a repository-internal, acyclic target or gitignore it.",
  ];
  return error;
}

function normalizeIgnoredPaths(paths) {
  return paths
    .map((ignoredPath) => ignoredPath.replace(/\/$/, ""))
    .toSorted((left, right) => left.length - right.length)
    .filter(
      (ignoredPath, index, allPaths) =>
        !allPaths
          .slice(0, index)
          .some((parentPath) => ignoredPath.startsWith(`${parentPath}/`))
    );
}

function matchesIgnoredPath(relativePath, ignoredPaths) {
  return ignoredPaths.some(
    (ignoredPath) =>
      relativePath === ignoredPath || relativePath.startsWith(`${ignoredPath}/`)
  );
}

function normalizeRelativePath(value) {
  return value.split(sep).join("/");
}

function isPathWithin(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

async function listGitIgnoredPaths(root) {
  const result = await collectCommand(
    "git",
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    { cwd: root }
  );

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `git exited ${result.exitCode}`;
    const error = new Error(
      `could not discover gitignored paths; refusing to run Turbo against the unfiltered repository (${detail}).`
    );
    error.code = "GIT_IGNORE_DISCOVERY_FAILED";
    error.is_retriable = false;
    error.suggestions = [
      "Run this command inside a Git worktree and verify that `git status` succeeds.",
    ];
    throw error;
  }

  return normalizeIgnoredPaths(result.stdout.split("\0").filter(Boolean));
}

function runTurboBoundaries({ root, quiet }) {
  return new Promise((resolve) => {
    const child = spawn("turbo", ["boundaries"], {
      cwd: root,
      shell: process.platform === "win32",
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;

    if (quiet) {
      child.stdout?.on("data", (chunk) => {
        const captured = appendCapturedOutput(stdout, chunk.toString());
        stdout = captured.output;
        stdoutTruncated ||= captured.truncated;
      });
      child.stderr?.on("data", (chunk) => {
        const captured = appendCapturedOutput(stderr, chunk.toString());
        stderr = captured.output;
        stderrTruncated ||= captured.truncated;
      });
    }

    child.on("error", (error) => {
      const problem = {
        code: "TURBO_NOT_FOUND",
        is_retriable: false,
        message: `could not run \`turbo boundaries\` (${error.message}).`,
        suggestions: ["Install turbo or run `boundaries check --no-turbo`."],
      };
      if (!quiet) {
        process.stderr.write(
          `boundaries: ${problem.message} ${problem.suggestions[0]}\n`
        );
      }
      resolve({
        error: problem,
        exitCode: 69,
        stderr,
        stderrTruncated,
        stdout,
        stdoutTruncated,
      });
    });

    child.on("close", (code, signal) => {
      const exitCode = code ?? 1;
      resolve({
        error:
          exitCode === 0
            ? undefined
            : {
                code: "TURBO_BOUNDARIES_FAILED",
                message: "`turbo boundaries` reported violations.",
                is_retriable: false,
                suggestions: [
                  "Read the captured Turbo output and fix package imports or dependency declarations.",
                ],
              },
        exitCode,
        stderr,
        stderrTruncated,
        signal,
        stdout,
        stdoutTruncated,
      });
    });
  });
}

function collectCommand(command, args, { cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stderr: `${stderr}${error.message}`,
        stdout,
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stderr,
        stdout,
      });
    });
  });
}

function appendCapturedOutput(currentOutput, chunk) {
  const available = OUTPUT_CAPTURE_LIMIT - currentOutput.length;
  if (available <= 0) {
    return { output: currentOutput, truncated: chunk.length > 0 };
  }

  if (chunk.length >= available) {
    return {
      output: `${currentOutput}${chunk.slice(0, available)}`,
      truncated: true,
    };
  }

  return {
    output: `${currentOutput}${chunk}`,
    truncated: false,
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}
