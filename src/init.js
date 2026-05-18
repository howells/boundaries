import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  applyRootBoundaryConfig,
  createPackageTurboConfig,
  inferTagsForWorkspace,
} from "./core.js";

export async function initRepository({ root = process.cwd(), dryRun = false } = {}) {
  const rootPackageJsonPath = join(root, "package.json");
  const rootTurboJsonPath = join(root, "turbo.json");
  const rootPackageJson = await readJson(rootPackageJsonPath);
  const rootTurboJson = await readJson(rootTurboJsonPath, {});
  const workspaces = await discoverWorkspaces(root, rootPackageJson);
  const plannedWrites = [];

  rootPackageJson.scripts = {
    ...(rootPackageJson.scripts ?? {}),
    boundaries: rootPackageJson.scripts?.boundaries ?? "boundaries check",
  };

  await planJsonWrite({
    root,
    filePath: rootPackageJsonPath,
    value: rootPackageJson,
    dryRun,
    plannedWrites,
  });
  await planJsonWrite({
    root,
    filePath: rootTurboJsonPath,
    value: applyRootBoundaryConfig(rootTurboJson),
    dryRun,
    plannedWrites,
  });

  for (const workspace of workspaces) {
    const turboJsonPath = join(root, workspace.path, "turbo.json");
    const currentTurboJson = await readJson(turboJsonPath, {});
    const tags = inferTagsForWorkspace(workspace);
    await planJsonWrite({
      root,
      filePath: turboJsonPath,
      value: createPackageTurboConfig(currentTurboJson, tags),
      dryRun,
      plannedWrites,
    });
  }

  return { dryRun, workspaces, plannedWrites };
}

export async function discoverWorkspaces(root, rootPackageJson = undefined) {
  const packageJson = rootPackageJson ?? (await readJson(join(root, "package.json")));
  const patterns = await workspacePatterns(root, packageJson);
  const workspaces = [];

  for (const pattern of patterns) {
    workspaces.push(...(await discoverPattern(root, pattern)));
  }

  return workspaces
    .sort((left, right) => left.path.localeCompare(right.path))
    .filter((workspace, index, allWorkspaces) => {
      return allWorkspaces.findIndex((candidate) => candidate.path === workspace.path) === index;
    });
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
  if (!pattern.endsWith("/*")) {
    return [];
  }

  const parentPath = pattern.slice(0, -2);
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
    const packageJson = await readJson(join(root, workspacePath, "package.json"), null);
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

async function readText(filePath, fallback = undefined) {
  try {
    return await readFile(filePath, "utf8");
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
  plannedWrites.push({
    path: relativePath(root, filePath),
    kind: "json",
    content: `${JSON.stringify(value, null, 2)}\n`,
  });

  if (!dryRun) {
    await writeJson(filePath, value);
  }
}

function relativePath(root, filePath) {
  return filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
}
