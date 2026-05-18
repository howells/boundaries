#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { checkRepository } from "./check.js";
import { evaluateDependency } from "./core.js";
import { discoverWorkspaces, initRepository } from "./init.js";
import {
  EXIT_CODES,
  failure,
  hasFlag,
  stripFlags,
  success,
  writeJson,
} from "./output.js";
import { commandSchema } from "./schema.js";

const HELP = `Usage: boundaries <command>

Commands:
  init                 Add Howells boundary conventions to a Turborepo workspace
  check [--no-turbo]   Validate boundary config and run turbo boundaries
  explain <from> <to>  Explain whether one workspace may depend on another
  help                 Show this help
`;

async function main(argv) {
  const [command, ...args] = argv;
  const json = hasFlag(argv, "--json");
  const schema = hasFlag(argv, "--schema");

  if (schema) {
    writeJson(process.stdout, success(commandSchema));
    return EXIT_CODES.OK;
  }

  if (!command || command === "help" || command === "--help" || command === "-h") {
    if (json) {
      writeJson(process.stdout, success(commandSchema));
      return EXIT_CODES.OK;
    }
    process.stdout.write(HELP);
    return EXIT_CODES.OK;
  }

  if (command === "init") {
    const result = await initRepository({ dryRun: hasFlag(args, "--dry-run") });
    if (json) {
      writeJson(process.stdout, success(summarizeInitResult(result)));
    } else {
      process.stdout.write(
        `${result.dryRun ? "Planned" : "Initialized"} boundaries for ${result.workspaces.length} workspace${result.workspaces.length === 1 ? "" : "s"}.\n`,
      );
    }
    return EXIT_CODES.OK;
  }

  if (command === "check") {
    const result = await checkRepository({
      runTurbo: !args.includes("--no-turbo"),
      quiet: json,
    });
    if (json) {
      if (result.ok) {
        writeJson(process.stdout, success({
          ok: true,
          workspaceCount: result.workspaces?.length ?? 0,
          ranTurbo: !args.includes("--no-turbo"),
          turbo: result.turbo
            ? { exitCode: result.turbo.exitCode, stdout: result.turbo.stdout, stderr: result.turbo.stderr }
            : undefined,
        }));
      } else {
        const primary = result.errors[0] ?? {
          code: "BOUNDARY_CHECK_FAILED",
          message: "Boundary check failed.",
          is_retriable: false,
          suggestions: ["Inspect command output and retry."],
        };
        writeJson(process.stderr, failure(primary, {
          errors: result.errors,
          turbo: result.turbo
            ? { exitCode: result.turbo.exitCode, stdout: result.turbo.stdout, stderr: result.turbo.stderr }
            : undefined,
        }));
      }
    }
    return result.exitCode;
  }

  if (command === "explain") {
    return explain(stripFlags(args, ["--json"]), { json });
  }

  const error = {
    code: "UNKNOWN_COMMAND",
    message: `Unknown command: ${command}`,
    is_retriable: false,
    suggestions: ["Run `boundaries --help` for available commands."],
  };
  if (json) {
    writeJson(process.stderr, failure(error));
  } else {
    process.stderr.write(`${error.message}\n\n${HELP}`);
  }
  return EXIT_CODES.USAGE;
}

async function explain(args, { json = false } = {}) {
  const [fromSelector, toSelector] = args;
  if (!fromSelector || !toSelector) {
    const error = {
      code: "USAGE_ERROR",
      message: "Usage: boundaries explain <from> <to>",
      is_retriable: false,
      suggestions: ["Provide both source and target workspace selectors."],
    };
    if (json) {
      writeJson(process.stderr, failure(error));
    } else {
      process.stderr.write(`${error.message}\n`);
    }
    return EXIT_CODES.USAGE;
  }

  const root = process.cwd();
  const rootPackageJson = await readJson(join(root, "package.json"));
  const rootTurboJson = await readJson(join(root, "turbo.json"));
  const workspaces = await discoverWorkspaces(root, rootPackageJson);
  const from = findWorkspace(workspaces, fromSelector);
  const to = findWorkspace(workspaces, toSelector);

  if (!from || !to) {
    const error = {
      code: "WORKSPACE_NOT_FOUND",
      message: "Could not find both workspaces. Use a package name or workspace path.",
      is_retriable: false,
      suggestions: ["Run `boundaries init --dry-run --json` to inspect discovered workspaces."],
    };
    if (json) {
      writeJson(process.stderr, failure(error));
    } else {
      process.stderr.write(`${error.message}\n`);
    }
    return EXIT_CODES.DATA;
  }

  const decision = evaluateDependency({
    rootConfig: rootTurboJson,
    fromName: from.name,
    fromTags: await readTags(root, from),
    toName: to.name,
    toTags: await readTags(root, to),
  });

  const data = {
    allowed: decision.allowed,
    reason: decision.reason,
    from: describeWorkspace(from, await readTags(root, from)),
    to: describeWorkspace(to, await readTags(root, to)),
  };

  if (json) {
    if (decision.allowed) {
      writeJson(process.stdout, success(data));
    } else {
      writeJson(process.stdout, failure({
        code: "BOUNDARY_BLOCKED",
        message: decision.reason,
        is_retriable: false,
        suggestions: ["Move shared code into a package or adjust package boundary tags intentionally."],
      }, data));
    }
  } else {
    process.stdout.write(
      `${from.name ?? from.path} -> ${to.name ?? to.path}: ${decision.allowed ? "allowed" : "blocked"}\n${decision.reason}\n`,
    );
  }

  return decision.allowed ? 0 : 1;
}

function summarizeInitResult(result) {
  return {
    dryRun: result.dryRun,
    workspaces: result.workspaces.map((workspace) => ({
      name: workspace.name,
      path: workspace.path,
    })),
    plannedWrites: result.plannedWrites.map((write) => ({
      path: write.path,
      kind: write.kind,
    })),
  };
}

function describeWorkspace(workspace, tags) {
  return {
    name: workspace.name,
    path: workspace.path,
    tags,
  };
}

function findWorkspace(workspaces, selector) {
  return workspaces.find((workspace) => {
    return workspace.name === selector || workspace.path === selector || workspace.path.endsWith(`/${selector}`);
  });
}

async function readTags(root, workspace) {
  const turboJson = await readJson(join(root, workspace.path, "turbo.json"), {});
  return turboJson.tags ?? [];
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

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const json = process.argv.includes("--json");
    const problem = {
      code: error.code === "ENOENT" ? "FILE_NOT_FOUND" : "UNHANDLED_ERROR",
      message: error.message,
      is_retriable: false,
      suggestions: ["Check that you are running from a workspace root with package.json."],
    };
    if (json) {
      writeJson(process.stderr, failure(problem));
    } else {
      process.stderr.write(`boundaries: ${error.message}\n`);
    }
    process.exitCode = error.code === "ENOENT" ? EXIT_CODES.DATA : EXIT_CODES.SOFTWARE;
  });
