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
import { checkProfile } from "./profile-check.js";
import { commandSchema } from "./schema.js";

const HELP = `Usage: boundaries [command]

Default command: check

Commands:
  init                 Add Howells boundary conventions to a Turborepo workspace
  check [--no-turbo]   Validate boundary config and run turbo boundaries
  check --profile <name>  Check JS architecture profile boundaries
  explain <from> <to>  Explain whether one workspace may depend on another
  help                 Show this help
`;

async function main(argv) {
  const [command, ...args] = argv;
  const json = hasFlag(argv, "--json");
  const schema = hasFlag(argv, "--schema");
  const effectiveCommand =
    !command || command.startsWith("-") ? "check" : command;
  const effectiveArgs = !command || command.startsWith("-") ? argv : args;

  if (schema) {
    writeJson(process.stdout, success(commandSchema));
    return EXIT_CODES.OK;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    if (json) {
      writeJson(process.stdout, success(commandSchema));
      return EXIT_CODES.OK;
    }
    process.stdout.write(HELP);
    return EXIT_CODES.OK;
  }

  if (effectiveCommand === "init") {
    const result = await initRepository({
      dryRun: hasFlag(effectiveArgs, "--dry-run"),
    });
    if (json) {
      writeJson(process.stdout, success(summarizeInitResult(result)));
    } else {
      process.stdout.write(
        `${result.dryRun ? "Planned" : "Initialized"} boundaries for ${result.workspaces.length} workspace${result.workspaces.length === 1 ? "" : "s"}.\n`
      );
    }
    return EXIT_CODES.OK;
  }

  if (effectiveCommand === "check") {
    const profile = optionValue(effectiveArgs, "--profile");
    if (profile) {
      const result = await checkProfile({ profile });
      if (json) {
        if (result.ok) {
          writeJson(process.stdout, success(result));
        } else {
          writeJson(
            process.stderr,
            failure(profileViolationProblem(result), result)
          );
        }
      } else if (result.ok) {
        process.stdout.write(
          `Profile ${result.profile} is valid across ${result.filesChecked} file${result.filesChecked === 1 ? "" : "s"}.\n`
        );
      } else {
        process.stderr.write(
          `Profile ${result.profile} found ${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}:\n`
        );
        for (const violation of result.violations) {
          process.stderr.write(
            `- ${violation.from} -> ${violation.specifier}: ${violation.rule}\n`
          );
        }
      }
      return result.ok ? EXIT_CODES.OK : 1;
    }

    const result = await checkRepository({
      quiet: json,
      runTurbo: !effectiveArgs.includes("--no-turbo"),
    });
    if (json) {
      if (result.ok) {
        writeJson(
          process.stdout,
          success({
            ok: true,
            ranTurbo: !effectiveArgs.includes("--no-turbo"),
            turbo: result.turbo
              ? summarizeTurboResult(result.turbo)
              : undefined,
            workspaceCount: result.workspaces?.length ?? 0,
          })
        );
      } else {
        const primary = result.errors[0] ?? {
          code: "BOUNDARY_CHECK_FAILED",
          is_retriable: false,
          message: "Boundary check failed.",
          suggestions: ["Inspect command output and retry."],
        };
        writeJson(
          process.stderr,
          failure(primary, {
            errors: result.errors,
            turbo: result.turbo
              ? summarizeTurboResult(result.turbo)
              : undefined,
          })
        );
      }
    }
    return result.exitCode;
  }

  if (effectiveCommand === "explain") {
    return explain(stripFlags(effectiveArgs, ["--json"]), { json });
  }

  const error = {
    code: "UNKNOWN_COMMAND",
    is_retriable: false,
    message: `Unknown command: ${command}`,
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
      is_retriable: false,
      message: "Usage: boundaries explain <from> <to>",
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
      is_retriable: false,
      message:
        "Could not find both workspaces. Use a package name or workspace path.",
      suggestions: [
        "Run `boundaries init --dry-run --json` to inspect discovered workspaces.",
      ],
    };
    if (json) {
      writeJson(process.stderr, failure(error));
    } else {
      process.stderr.write(`${error.message}\n`);
    }
    return EXIT_CODES.DATA;
  }

  const decision = evaluateDependency({
    fromName: from.name,
    fromTags: await readTags(root, from),
    rootConfig: rootTurboJson,
    toName: to.name,
    toTags: await readTags(root, to),
  });

  const data = {
    allowed: decision.allowed,
    from: describeWorkspace(from, await readTags(root, from)),
    reason: decision.reason,
    to: describeWorkspace(to, await readTags(root, to)),
  };

  if (json) {
    if (decision.allowed) {
      writeJson(process.stdout, success(data));
    } else {
      writeJson(
        process.stdout,
        failure(
          {
            code: "BOUNDARY_BLOCKED",
            is_retriable: false,
            message: decision.reason,
            suggestions: [
              "Move shared code into a package or adjust package boundary tags intentionally.",
            ],
          },
          data
        )
      );
    }
  } else {
    process.stdout.write(
      `${from.name ?? from.path} -> ${to.name ?? to.path}: ${decision.allowed ? "allowed" : "blocked"}\n${decision.reason}\n`
    );
  }

  return decision.allowed ? 0 : 1;
}

function summarizeInitResult(result) {
  return {
    dryRun: result.dryRun,
    plannedWrites: result.plannedWrites.map((write) => ({
      path: write.path,
      kind: write.kind,
    })),
    workspaces: result.workspaces.map((workspace) => ({
      name: workspace.name,
      path: workspace.path,
    })),
  };
}

function summarizeTurboResult(result) {
  return {
    exitCode: result.exitCode,
    ...(result.signal ? { signal: result.signal } : {}),
    stderr: result.stderr,
    stdout: result.stdout,
    ...(result.stdoutTruncated ? { stdoutTruncated: true } : {}),
    ...(result.stderrTruncated ? { stderrTruncated: true } : {}),
  };
}

function profileViolationProblem(result) {
  return {
    code: "PROFILE_BOUNDARY_VIOLATIONS",
    is_retriable: false,
    message: `${result.violations.length} profile boundary violation${result.violations.length === 1 ? "" : "s"} found.`,
    suggestions: [
      "Move the import to a lower layer or adjust the selected architecture profile.",
    ],
  };
}

function describeWorkspace(workspace, tags) {
  return {
    name: workspace.name,
    path: workspace.path,
    tags,
  };
}

function optionValue(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
}

function findWorkspace(workspaces, selector) {
  return workspaces.find(
    (workspace) =>
      workspace.name === selector ||
      workspace.path === selector ||
      workspace.path.endsWith(`/${selector}`)
  );
}

async function readTags(root, workspace) {
  const turboJson = await readJson(
    join(root, workspace.path, "turbo.json"),
    {}
  );
  return turboJson.tags ?? [];
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

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const json = process.argv.includes("--json");
    const problem = {
      code:
        error.code === "ENOENT"
          ? "FILE_NOT_FOUND"
          : (error.code ?? "UNHANDLED_ERROR"),
      is_retriable: error.is_retriable ?? false,
      message: error.message,
      suggestions: error.suggestions ?? [
        "Check that you are running from a workspace root with package.json.",
      ],
    };
    if (json) {
      writeJson(process.stderr, failure(problem));
    } else {
      process.stderr.write(`boundaries: ${error.message}\n`);
    }
    process.exitCode =
      error.code === "ENOENT" ? EXIT_CODES.DATA : EXIT_CODES.SOFTWARE;
  });
