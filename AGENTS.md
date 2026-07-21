# @howells/boundaries

Package-level boundary conventions for Turborepo workspaces. The npm package is `@howells/boundaries`; the executable is `boundaries`.

## Commands

```sh
npm test                         # Run unit and CLI contract tests
npm run validate:skill            # Validate bundled Codex skill metadata
npm run smoke:install             # Pack, install in a temp project, run the bin
npm pack --dry-run                # Inspect publish contents
node src/cli.js --schema          # Print machine-readable command schema
node src/cli.js init --dry-run    # Preview generated Turbo boundary files
```

## Key Files

- `src/cli.js`: command parsing and output formatting.
- `src/init.js`: workspace discovery and config generation.
- `src/check.js`: local config validation and `turbo boundaries` delegation.
- `src/core.js`: tag inference and dependency rule evaluation.
- `src/schema.js`: machine-readable CLI schema.
- `skills/howells-boundaries/SKILL.md`: bundled Codex skill.

## Conventions

- Keep the tool package-level. Do not add package-internal layer enforcement here.
- Prefer Turbo `boundaries` as the backend; this package is a convention layer.
- CLI commands must stay non-interactive.
- Any new command output should support `--json` when an agent may consume it.
- Mutating commands should support `--dry-run` before they write files.

## Permissions

Always:

- Read and edit files in this package.
- Run `npm test`, `npm run validate:skill`, and `npm pack --dry-run`.

Ask first:

- Publish a new npm version.
- Change the default boundary policy.
- Add runtime dependencies.

Never:

- Weaken generated boundary rules just to silence violations.
- Edit user repos outside this package unless explicitly asked.
