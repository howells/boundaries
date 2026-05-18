# @howells/boundaries

Opinionated package-boundary conventions for Turborepo workspaces.

The executable is `boundaries`.

## Install

```sh
pnpm add -D @howells/boundaries
```

## Use

Try without installing:

```sh
npx @howells/boundaries --help
npx @howells/boundaries init --dry-run
```

Initialize boundary config:

```sh
pnpm exec boundaries init
```

This adds:

- root `turbo.json` boundary rules
- package-level `turbo.json` tags
- a root `package.json` script: `"boundaries": "boundaries check"`

Run checks:

```sh
pnpm boundaries
```

or:

```sh
pnpm exec boundaries check
```

Explain a relationship:

```sh
pnpm exec boundaries explain apps/web packages/ui
pnpm exec boundaries explain apps/web apps/admin
```

Machine-readable output:

```sh
pnpm exec boundaries --schema
pnpm exec boundaries init --dry-run --json
pnpm exec boundaries explain apps/web packages/ui --json
```

## Default Policy

The default tags are:

```text
type:app
type:package
type:tooling
scope:<workspace-name>
visibility:public
visibility:internal
```

The default rules are:

```text
type:app      cannot depend on type:app
type:package  cannot depend on type:app
type:tooling  cannot depend on type:app
```

This blocks app-to-app imports and keeps shared packages from reaching into deployable apps.

`visibility:*` tags are generated as metadata, but no default rule is attached to them yet. Public packages often depend on private dev tooling packages, so runtime visibility policy needs a more precise model.

## Backend

`boundaries check` validates the generated convention layer, then delegates to:

```sh
turbo boundaries
```

Use this in Turborepo repos that already have `turbo` installed.
