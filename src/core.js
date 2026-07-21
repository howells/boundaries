const DEFAULT_ROOT_BOUNDARY_TAGS = {
  "type:app": {
    dependencies: {
      deny: ["type:app"],
    },
  },
  "type:package": {
    dependencies: {
      deny: ["type:app"],
    },
  },
  "type:tooling": {
    dependencies: {
      deny: ["type:app"],
    },
  },
};

export function inferTagsForWorkspace(workspace) {
  const normalizedPath = normalizePath(workspace.path);
  const packageName = workspace.name ?? "";
  const scope = inferScope(normalizedPath, packageName);
  const type = inferType(normalizedPath);
  const visibility =
    workspace.packageJson?.private === false ? "public" : "internal";

  return [`type:${type}`, `scope:${scope}`, `visibility:${visibility}`];
}

export function createPackageTurboConfig(currentConfig = {}, tags) {
  return {
    ...currentConfig,
    extends: ensureRootExtends(currentConfig.extends),
    tags: unique(tags),
  };
}

export function applyRootBoundaryConfig(currentConfig = {}) {
  return {
    ...currentConfig,
    boundaries: {
      ...currentConfig.boundaries,
      tags: mergeBoundaryTags(
        DEFAULT_ROOT_BOUNDARY_TAGS,
        currentConfig.boundaries?.tags ?? {}
      ),
    },
  };
}

export function evaluateDependency({
  rootConfig,
  fromTags,
  toTags,
  fromName,
  toName,
}) {
  const tagRules = rootConfig.boundaries?.tags ?? {};
  const targetSelectors = new Set([...toTags, toName].filter(Boolean));
  const sourceSelectors = new Set([...fromTags, fromName].filter(Boolean));

  for (const fromTag of fromTags) {
    const dependencyDecision = evaluateRuleSet({
      activeTag: fromTag,
      candidateSelectors: targetSelectors,
      direction: "dependency",
      ruleSet: tagRules[fromTag]?.dependencies,
    });

    if (!dependencyDecision.allowed) {
      return dependencyDecision;
    }
  }

  for (const toTag of toTags) {
    const dependentDecision = evaluateRuleSet({
      activeTag: toTag,
      candidateSelectors: sourceSelectors,
      direction: "dependent",
      ruleSet: tagRules[toTag]?.dependents,
    });

    if (!dependentDecision.allowed) {
      return dependentDecision;
    }
  }

  return { allowed: true, reason: "No boundary rule blocks this dependency." };
}

function evaluateRuleSet({
  ruleSet,
  candidateSelectors,
  direction,
  activeTag,
}) {
  if (!ruleSet) {
    return { allowed: true };
  }

  const denied = ruleSet.deny?.find((selector) =>
    candidateSelectors.has(selector)
  );
  if (denied) {
    return {
      allowed: false,
      reason: `${activeTag} denies ${direction} selector ${denied}.`,
    };
  }

  if (ruleSet.allow?.length > 0) {
    const allowed = ruleSet.allow.some((selector) =>
      candidateSelectors.has(selector)
    );
    if (!allowed) {
      return {
        allowed: false,
        reason: `${activeTag} only allows ${direction} selectors: ${ruleSet.allow.join(", ")}.`,
      };
    }
  }

  return { allowed: true };
}

function mergeBoundaryTags(defaultTags, existingTags) {
  const merged = { ...defaultTags, ...existingTags };

  for (const tag of Object.keys(defaultTags)) {
    merged[tag] = mergeBoundaryTag(defaultTags[tag], existingTags[tag] ?? {});
  }

  return merged;
}

function mergeBoundaryTag(defaultTag, existingTag) {
  const merged = {
    ...defaultTag,
    ...existingTag,
    dependencies: mergeRelationship(
      defaultTag.dependencies,
      existingTag.dependencies
    ),
    dependents: mergeRelationship(
      defaultTag.dependents,
      existingTag.dependents
    ),
  };

  if (!merged.dependencies) {
    delete merged.dependencies;
  }

  if (!merged.dependents) {
    delete merged.dependents;
  }

  return merged;
}

function mergeRelationship(defaultRelationship, existingRelationship) {
  if (!defaultRelationship && !existingRelationship) {
    return;
  }

  const merged = {
    ...defaultRelationship,
    ...existingRelationship,
  };

  const allow = unique([
    ...(defaultRelationship?.allow ?? []),
    ...(existingRelationship?.allow ?? []),
  ]);
  const deny = unique([
    ...(defaultRelationship?.deny ?? []),
    ...(existingRelationship?.deny ?? []),
  ]);

  if (allow.length > 0) {
    merged.allow = allow;
  } else {
    delete merged.allow;
  }

  if (deny.length > 0) {
    merged.deny = deny;
  } else {
    delete merged.deny;
  }

  return merged;
}

function inferType(workspacePath) {
  if (workspacePath.startsWith("apps/") || workspacePath === "apps") {
    return "app";
  }

  if (
    workspacePath.startsWith("tooling/") ||
    workspacePath.startsWith("tools/") ||
    workspacePath.includes("/eslint") ||
    workspacePath.includes("/lint") ||
    workspacePath.includes("/config")
  ) {
    return "tooling";
  }

  return "package";
}

function inferScope(workspacePath, packageName) {
  const pathParts = workspacePath.split("/").filter(Boolean);
  if (pathParts.length > 1) {
    return sanitizeTagValue(pathParts.at(-1));
  }

  const unscopedName = packageName.includes("/")
    ? packageName.split("/").at(-1)
    : packageName;

  return sanitizeTagValue(unscopedName || pathParts.at(-1) || "unknown");
}

function ensureRootExtends(extendsValue) {
  if (!Array.isArray(extendsValue) || extendsValue.length === 0) {
    return ["//"];
  }

  if (extendsValue[0] === "//") {
    return extendsValue;
  }

  return ["//", ...extendsValue.filter((value) => value !== "//")];
}

function normalizePath(value) {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .replace(/\/$/, "");
}

function sanitizeTagValue(value) {
  return value
    .toLowerCase()
    .replace(/^@/, "")
    .replaceAll(/[^a-z0-9._-]+/g, "-");
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined))];
}
