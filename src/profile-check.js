import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const PROFILE_DEFINITIONS = {
  "clean-node": {
    description:
      "Clean/hexagonal Node.js layering: adapters/infrastructure -> application -> domain.",
    layers: {
      adapters: 3,
      application: 2,
      domain: 1,
      infrastructure: 3,
    },
  },
  "feature-sliced": {
    description:
      "Feature-Sliced Design style app/pages/widgets/features/entities/shared ordering.",
    layers: {
      app: 5,
      entities: 1,
      features: 2,
      pages: 4,
      shared: 0,
      widgets: 3,
    },
  },
  "next-feature": {
    description:
      "Next.js app router with feature, entity, and shared source layers.",
    layers: {
      app: 4,
      components: 3,
      entities: 1,
      features: 2,
      lib: 0,
      pages: 4,
      shared: 0,
    },
  },
};

export async function checkProfile({ root = process.cwd(), profile }) {
  const definition = PROFILE_DEFINITIONS[profile];
  if (!definition) {
    const error = new Error(`Unknown profile: ${profile}`);
    error.code = "UNKNOWN_PROFILE";
    error.is_retriable = false;
    error.suggestions = [
      `Use one of: ${Object.keys(PROFILE_DEFINITIONS).join(", ")}`,
    ];
    throw error;
  }

  const files = await listSourceFiles(root);
  const violations = [];

  for (const file of files) {
    const from = normalizePath(relative(root, file));
    const fromLayer = layerForPath(from, definition);
    if (!fromLayer) {
      continue;
    }

    const source = await readFile(file, "utf-8");
    for (const specifier of importSpecifiers(source)) {
      const to = resolveImportSpecifier({ fromFile: file, root, specifier });
      if (!to) {
        continue;
      }

      const toLayer = layerForPath(to, definition);
      if (!toLayer) {
        continue;
      }

      if (definition.layers[fromLayer] < definition.layers[toLayer]) {
        violations.push({
          from,
          fromLayer,
          rule: `${fromLayer} cannot import ${toLayer}`,
          specifier,
          to,
          toLayer,
        });
      }
    }
  }

  return {
    description: definition.description,
    filesChecked: files.length,
    ok: violations.length === 0,
    profile,
    violations,
  };
}

async function listSourceFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await listSourceFiles(root, entryPath)));
      }
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.toSorted((left, right) => left.localeCompare(right));
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function resolveImportSpecifier({ root, fromFile, specifier }) {
  if (specifier.startsWith(".")) {
    return normalizePath(relative(root, resolve(dirname(fromFile), specifier)));
  }

  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return `src/${specifier.slice(2)}`;
  }

  if (specifier.startsWith("src/")) {
    return specifier;
  }

  return null;
}

function layerForPath(filePath, definition) {
  const normalized = normalizePath(filePath).replace(/^src\//, "");
  const [segment] = normalized.split("/");
  return Object.hasOwn(definition.layers, segment) ? segment : null;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "");
}
