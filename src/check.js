import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { discoverWorkspaces } from "./init.js";

const OUTPUT_CAPTURE_LIMIT = 64 * 1024;

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
    return { ok: false, exitCode: 1, errors };
  }

  if (!runTurbo) {
    if (!quiet) {
      stdout.write(`Boundary configuration is valid for ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}.\n`);
    }
    return { ok: true, exitCode: 0, errors: [], workspaces };
  }

  const turboResult = await runTurboBoundaries({ root, quiet });
  const turboExitCode = turboResult.exitCode;
  return {
    ok: turboExitCode === 0,
    exitCode: turboExitCode,
    errors: turboExitCode === 0 ? [] : [turboResult.error],
    turbo: turboResult,
    workspaces,
  };
}

async function validateBoundarySetup(root, rootTurboJson, workspaces) {
  const errors = [];

  if (!rootTurboJson.boundaries?.tags) {
    errors.push({
      code: "ROOT_BOUNDARIES_MISSING",
      message: "root turbo.json is missing boundaries.tags; run `boundaries init`.",
      file: "turbo.json",
      is_retriable: false,
      suggestions: ["Run `boundaries init`."],
    });
  }

  for (const workspace of workspaces) {
    const packageTurboJson = await readJson(join(root, workspace.path, "turbo.json"), {});
    if (!Array.isArray(packageTurboJson.tags) || packageTurboJson.tags.length === 0) {
      errors.push({
        code: "PACKAGE_TAGS_MISSING",
        message: `${workspace.path}/turbo.json is missing package boundary tags.`,
        file: `${workspace.path}/turbo.json`,
        is_retriable: false,
        suggestions: ["Run `boundaries init`."],
      });
    }
  }

  return errors;
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
        message: `could not run \`turbo boundaries\` (${error.message}).`,
        is_retriable: false,
        suggestions: ["Install turbo or run `boundaries check --no-turbo`."],
      };
      if (!quiet) {
        process.stderr.write(`boundaries: ${problem.message} ${problem.suggestions[0]}\n`);
      }
      resolve({
        exitCode: 69,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        error: problem,
      });
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      resolve({
        exitCode,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        error: exitCode === 0
          ? undefined
          : {
              code: "TURBO_BOUNDARIES_FAILED",
              message: "`turbo boundaries` reported violations.",
              is_retriable: false,
              suggestions: ["Read the captured Turbo output and fix package imports or dependency declarations."],
            },
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

async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}
