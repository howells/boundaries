# Surface Plan: @howells/boundaries

Date: 2026-05-18

Goal: move `@howells/boundaries` from agent-tolerant to agent-ready without expanding beyond package-level Turborepo boundaries.

## Tasks

### S1: Add Structured CLI Output

- Description: Add `--json` to `init`, `check`, `explain`, `help`, and all error paths with a stable envelope.
- Files: `src/cli.js`, `src/check.js`, `src/init.js`, `test/cli.test.js`
- Complexity: M
- Score impact: CLI Design 1/3 -> 2/3, Error Handling 1/3 -> 2/3
- Dependencies: none
- Verification: `npm test`; run `node src/cli.js explain apps/web packages/ui --json` in a fixture repo.

### S2: Add `--dry-run` for Mutations

- Description: Make `boundaries init --dry-run` report planned file changes without writing them.
- Files: `src/cli.js`, `src/init.js`, `test/init.test.js`, `README.md`
- Complexity: M
- Score impact: CLI Design 2/3 target support
- Dependencies: S1 recommended but not required
- Verification: fixture repo before/after file hashes remain unchanged.

### S3: Add Schema Introspection

- Description: Add `boundaries --schema` and command-specific schemas for inputs/outputs/errors.
- Files: `src/cli.js`, new `src/schema.js`, `test/cli.test.js`, `README.md`
- Complexity: M
- Score impact: CLI Design 2/3 -> 3/3, Tool Design 1/3 -> 2/3
- Dependencies: S1
- Verification: `node src/cli.js --schema | jq`.

### S4: Add Root Agent Context

- Description: Add `AGENTS.md` with exact commands, package purpose, release checks, permission boundaries, and gotchas.
- Files: `AGENTS.md`
- Complexity: S
- Score impact: Context Files 1/3 -> 2/3, Discovery & AEO 1/3 -> 2/3
- Dependencies: none
- Verification: line count under 150; commands match `package.json`.

### S5: Enrich Package Discovery Metadata

- Description: Add `repository`, `bugs`, `homepage`, and `keywords`; expand README with npx/pnpm dlx examples and expected outputs.
- Files: `package.json`, `README.md`
- Complexity: S
- Score impact: Discovery & AEO 1/3 -> 2/3
- Dependencies: none
- Verification: `npm pack --dry-run`; `npm view` after next publish.

### S6: Add Published Package Smoke Test

- Description: Add a release verification script that packs the package, installs it into a temp project, and runs `boundaries --help`.
- Files: `scripts/smoke-install.mjs`, `package.json`
- Complexity: S
- Score impact: Testing 2/3 stronger confidence
- Dependencies: none
- Verification: `npm run smoke:install`.

### S7: Consider MCP Tool Manifest Later

- Description: Expose read-only `check` and `explain` operations as MCP tools or a tool schema manifest after the CLI stabilizes.
- Files: future `src/tools.js` or `mcp/`
- Complexity: L
- Score impact: MCP Server 0/3 -> 1-2/3, Tool Design 2/3 -> 3/3
- Dependencies: S1, S3
- Verification: MCP client lists tools and calls `explain` in an in-memory fixture.
