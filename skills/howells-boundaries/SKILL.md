---
name: howells-boundaries
description: Use when adding, checking, explaining, or repairing package-level architecture boundaries in Turborepo JavaScript/TypeScript monorepos with the `boundaries` CLI from `@howells/boundaries`.
---

# Howells Boundaries

Use `@howells/boundaries` for package-level architecture enforcement in Turborepo workspaces. The executable is `boundaries`.

## Workflow

1. Confirm the repo is a Turborepo workspace by checking for `turbo.json` and workspace packages in `package.json`, `pnpm-workspace.yaml`, or equivalent package-manager config.
2. Install or use `@howells/boundaries` from the repo’s chosen package manager.
3. Run `boundaries init` to add root Turbo boundary rules and per-package `turbo.json` tags.
4. Review generated tags before accepting them. Fix incorrect tags instead of weakening policy.
5. Run `boundaries check`.
6. If a violation appears, prefer fixing the import or dependency declaration. Use exceptions only when they are narrow, temporary, and documented.

## Default Model

Use these package tags unless the repo already has a clearer convention:

```text
type:app
type:package
type:tooling
scope:<name>
platform:browser
platform:node
visibility:public
visibility:internal
```

Default rules:

```text
type:app      cannot depend on type:app
type:package  cannot depend on type:app
type:tooling  cannot depend on type:app
```

This blocks app-to-app imports and keeps shared packages from reaching into deployable apps. Treat `visibility:*` as metadata until the checker can distinguish runtime dependencies from dev-only tooling dependencies.

## Good Fixes

- Move shared code from an app into a package, then import the package.
- Add a missing internal package dependency to the importing package’s `package.json`.
- Use the package public entrypoint instead of importing files across package directories.
- Split package tags by purpose when a package has unclear ownership.

## Avoid

- Do not use ESLint as the primary enforcement mechanism.
- Do not add broad allowlists to make a check pass.
- Do not move task logic into root `package.json`; keep Turbo package tasks in packages and root scripts as delegators.
- Do not invent package-internal layer rules for this tool. Keep v1 package-level; use another tool later for module-level boundaries if needed.

## Fallbacks

Use `turbo boundaries` as the backend when available. Consider `dependency-cruiser` or `rev-dep` only when the user asks for graph analysis that Turbo boundaries cannot answer.
