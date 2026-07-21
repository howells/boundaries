import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  applyRootBoundaryConfig,
  createPackageTurboConfig,
  inferTagsForWorkspace,
} from "./core.js";

export async function initRepository({
  root = process.cwd(),
  dryRun = false,
} = {}) {
  const rootPackageJsonPath = join(root, "package.json");
  const rootTurboJsonPath = join(root, "turbo.json");
  const rootPackageJson = await readJson(rootPackageJsonPath);
  const rootTurboJson = await readJson(rootTurboJsonPath, {});
  const workspaces = await discoverWorkspaces(root, rootPackageJson);
  const plannedWrites = [];

  rootPackageJson.scripts = {
    ...rootPackageJson.scripts,
    boundaries: rootPackageJson.scripts?.boundaries ?? "boundaries check",
  };

  await planJsonWrite({
    dryRun,
    filePath: rootPackageJsonPath,
    plannedWrites,
    root,
    value: rootPackageJson,
  });
  await planJsonWrite({
    dryRun,
    filePath: rootTurboJsonPath,
    plannedWrites,
    root,
    value: applyRootBoundaryConfig(rootTurboJson),
  });

  for (const workspace of workspaces) {
    const turboJsonPath = join(root, workspace.path, "turbo.json");
    const currentTurboJson = await readJson(turboJsonPath, {});
    const tags = inferTagsForWorkspace(workspace);
    await planJsonWrite({
      dryRun,
      filePath: turboJsonPath,
      plannedWrites,
      root,
      value: createPackageTurboConfig(currentTurboJson, tags),
    });
  }

  return { dryRun, plannedWrites, workspaces };
}

export async function discoverWorkspaces(root, rootPackageJson) {
  const packageJson =
    rootPackageJson ?? (await readJson(join(root, "package.json")));
  const patterns = await workspacePatterns(root, packageJson);
  const workspaces = [];

  for (const pattern of patterns) {
    workspaces.push(...(await discoverPattern(root, pattern)));
  }

  return workspaces
    .toSorted((left, right) => left.path.localeCompare(right.path))
    .filter(
      (workspace, index, allWorkspaces) =>
        allWorkspaces.findIndex(
          (candidate) => candidate.path === workspace.path
        ) === index
    );
}

async function workspacePatterns(root, packageJson) {
  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  if (Array.isArray(packageJson.workspaces?.packages)) {
    return packageJson.workspaces.packages;
  }

  const pnpmWorkspace = await readText(join(root, "pnpm-workspace.yaml"), null);
  if (pnpmWorkspace) {
    const patterns = parsePnpmWorkspacePackages(pnpmWorkspace);
    if (patterns.length > 0) {
      return patterns;
    }
  }

  return ["apps/*", "packages/*"];
}

function parsePnpmWorkspacePackages(contents) {
  const patterns = [];
  let inPackages = false;

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }

    if (inPackages && /^\S/.test(line) && !line.startsWith("packages:")) {
      inPackages = false;
    }

    if (!inPackages) {
      continue;
    }

    const match = line.match(/^\s*-\s+["']?([^"']+)["']?\s*$/);
    if (match && !match[1].startsWith("!")) {
      patterns.push(match[1]);
    }
  }

  return patterns;
}

async function discoverPattern(root, pattern) {
  const normalizedPattern = normalizeWorkspacePattern(pattern);
  if (!normalizedPattern || normalizedPattern.startsWith("!")) {
    return [];
  }

  if (normalizedPattern.endsWith("/*")) {
    return discoverGlobPattern(root, normalizedPattern);
  }

  if (normalizedPattern.includes("*")) {
    return [];
  }

  return discoverExactPattern(root, normalizedPattern);
}

async function discoverGlobPattern(root, pattern) {
  const parentPath = assertSafeWorkspacePath(
    root,
    pattern.slice(0, -2),
    pattern
  );
  await assertRealPathInsideRoot(root, parentPath, pattern);
  const absoluteParentPath = join(root, parentPath);
  let entries;

  try {
    entries = await readdir(absoluteParentPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const workspaces = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspacePath = `${parentPath}/${entry.name}`;
    const packageJson = await readJson(
      join(root, workspacePath, "package.json"),
      null
    );
    if (!packageJson) {
      continue;
    }

    workspaces.push({
      name: packageJson.name,
      packageJson,
      path: workspacePath,
    });
  }

  return workspaces;
}

async function discoverExactPattern(root, pattern) {
  const workspacePath = assertSafeWorkspacePath(root, pattern, pattern);
  await assertRealPathInsideRoot(root, workspacePath, pattern);
  const packageJson = await readJson(
    join(root, workspacePath, "package.json"),
    null
  );
  if (!packageJson) {
    return [];
  }

  return [
    {
      name: packageJson.name,
      packageJson,
      path: workspacePath,
    },
  ];
}

function assertSafeWorkspacePath(root, workspacePath, pattern) {
  const resolvedRoot = resolve(root);
  const resolvedWorkspace = resolve(root, workspacePath);
  const relativeWorkspace = relative(resolvedRoot, resolvedWorkspace);

  if (relativeWorkspace.startsWith("..") || isAbsolute(relativeWorkspace)) {
    const error = new Error(
      `Workspace pattern escapes repository root: ${pattern}`
    );
    error.code = "UNSAFE_WORKSPACE_PATTERN";
    error.is_retriable = false;
    error.suggestions = ["Use workspace paths inside the repository root."];
    throw error;
  }

  return normalizeWorkspacePattern(relativeWorkspace);
}

async function assertRealPathInsideRoot(root, workspacePath, pattern) {
  const resolvedRoot = await realpath(root);
  let resolvedWorkspace;

  try {
    resolvedWorkspace = await realpath(resolve(root, workspacePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const relativeWorkspace = relative(resolvedRoot, resolvedWorkspace);

  if (relativeWorkspace.startsWith("..") || isAbsolute(relativeWorkspace)) {
    const error = new Error(
      `Workspace pattern escapes repository root: ${pattern}`
    );
    error.code = "UNSAFE_WORKSPACE_PATTERN";
    error.is_retriable = false;
    error.suggestions = ["Use workspace paths inside the repository root."];
    throw error;
  }
}

function normalizeWorkspacePattern(pattern) {
  return pattern
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .replace(/\/$/, "");
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

async function readText(filePath, fallback) {
  try {
    return await readFile(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function planJsonWrite({ root, filePath, value, dryRun, plannedWrites }) {
  await assertRealPathInsideRoot(root, dirname(filePath), filePath);

  plannedWrites.push({
    content: `${JSON.stringify(value, null, 2)}\n`,
    kind: "json",
    path: relativePath(root, filePath),
  });

  if (!dryRun) {
    await writeJson(filePath, value);
  }
}

function relativePath(root, filePath) {
  return filePath.startsWith(`${root}/`)
    ? filePath.slice(root.length + 1)
    : filePath;
}
