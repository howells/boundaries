# Audit Report: full codebase

**Date:** 2026-05-19
**Reviewers:** security-engineer, performance-engineer, senior-engineer
**Scope:** full codebase
**Project Type:** small Node.js ESM CLI package
**Project Stage:** development

> Severity ratings have been calibrated for the **development** stage. Issues marked with down arrows were downgraded from their production-level severity.

## Structural Hotspots

- **Long files >250 LOC:** 0
- **Severe long files >400 LOC:** 0
- **Suspicious boundary files:** 0
- **Suspicious + long overlap:** 0

| File | LOC | Note |
|---|---:|---|
| `src/cli.js` | 249 | Near the 250 LOC hotspot threshold, but still cohesive around command routing. |
| `src/core.js` | 235 | Core policy logic is compact and well covered by tests. |

## Scorecard: 11/21 — Developing

| # | Axis | Score | |
|---|------|:-----:|-|
| 1 | Security Posture | 1/3 | No CVEs or command injection risks found, but mutating writes are not confined to the repository root. |
| 2 | Performance | 2/3 | Workspace discovery is simple and fast for realistic sizes; subprocess output capture and smoke temp cleanup remain low-risk issues. |
| 3 | Architecture | 2/3 | Clear small-module structure with no deep imports or large files; discovery semantics need sharper boundaries. |
| 4 | Code Quality | 1/3 | Code is readable and tests pass, but there is no lint/type/dead-code gate and Knip found one unused export. |
| 5 | Test Health | 2/3 | CLI and core behavior are covered with 14 passing tests; edge cases around unsafe and explicit workspace patterns are missing. |
| 6 | Resilience | 2/3 | JSON error envelopes and dry-run behavior are solid, but workspace discovery can silently skip or escape intended scope. |
| 7 | Operations | 1/3 | `npm test`, `validate:skill`, `smoke:install`, and `npm pack --dry-run` pass, but there is no detected CI, lint, or typecheck pipeline. |
| | **Total** | **11/21** | **Developing** |

## Executive Summary

The package is small, well focused, and mechanically healthy: tests pass, skill metadata validates, smoke install works, dry-run packing includes the expected publish contents, and `npm audit` reports zero high/critical vulnerabilities. The main risk is in `boundaries init`: workspace patterns are trusted too much, so a pattern containing `..` can cause writes outside the repository root.

The remaining findings are smaller correctness and maintenance issues: exact workspace entries are silently ignored, the bundled skill documents tags the CLI does not emit, JSON mode can buffer large Turbo output, smoke installs leave temp projects behind, and one unused export is present.

- **Critical:** 0 issues
- **High:** 1 issue
- **Medium:** 1 issue
- **Low:** 4 issues

## Must Fix

### Constrain workspace discovery and writes to the repository root
**File:** `src/init.js:118`
**Flagged by:** security-engineer, senior-engineer
**Description:** `discoverPattern` accepts any workspace pattern ending in `/*`, then joins the raw parent path back to `root`. A fixture with `workspaces: ["../outside/*"]` caused `boundaries init --json` to succeed and write `../outside/pkg/turbo.json`.
**Recommendation:** Reject workspace patterns that resolve outside `root` before discovery and before writing planned files. Add tests for both dry-run and non-dry-run behavior.

## Should Consider

### Support or reject explicit workspace entries clearly
**File:** `src/init.js:118`
**Flagged by:** senior-engineer
**Description:** `discoverPattern` returns `[]` for valid exact workspace entries such as `workspaces: ["packages/ui"]`, so `init`, `check`, and `explain` can skip real packages without warning.
**Recommendation:** Either support exact package paths or return a structured unsupported-pattern error. Silent success is the risky part.

## Worth Noting

### Cap captured Turbo output in JSON mode
**File:** `src/check.js:75`
**Flagged by:** performance-engineer
**Description:** `check --json` buffers all `turbo boundaries` stdout/stderr and embeds both in the response. A large monorepo with many violations could produce a very large JSON payload.
**Recommendation:** Consider capped capture with an overflow indicator, especially because JSON output is agent-consumable.

### Align bundled skill tags with generated CLI tags
**File:** `skills/howells-boundaries/SKILL.md:27`
**Flagged by:** senior-engineer
**Description:** The bundled skill lists `platform:browser` and `platform:node`, but `src/core.js` only emits `type`, `scope`, and `visibility` tags.
**Recommendation:** Either remove those tags from the skill's default model or implement platform tag inference intentionally.

### Clean smoke install temp projects
**File:** `scripts/smoke-install.mjs:9`
**Flagged by:** performance-engineer
**Description:** The smoke script deletes only the packed tarball, leaving the temporary project and installed `node_modules` behind.
**Recommendation:** Use `rm(temp, { recursive: true, force: true })` in a `finally` block after preserving useful failure output.

## Low Priority / Suggestions

### Remove the unused `problem` export or add dead-code checks
**File:** `src/output.js:25`
**Flagged by:** senior-engineer
**Description:** Knip reports `problem` as an unused export. The function is used internally by `failure`, but no external module imports it.
**Recommendation:** Make it private or add a dead-code check script so this does not drift.

---

## Task Clusters

> Findings grouped by what you'd tackle together, ordered by priority.

### 1. Workspace discovery safety

**Why:** This is the only high-severity cluster because it affects a mutating command and can write outside the intended repo.

| # | Severity | File | Issue | Flagged by |
|---|----------|------|-------|------------|
| 1 | High | `src/init.js:118` | Workspace patterns with `..` can escape root and write outside the repo. | security-engineer, senior-engineer |
| 2 | Medium | `src/init.js:118` | Exact workspace entries are silently ignored. | senior-engineer |

**Suggested approach:** Centralize workspace pattern normalization, reject resolved paths outside `root`, and add fixtures for glob, exact path, negated path, dry-run, and non-dry-run behavior.

### 2. Agent/package contract cleanup

**Why:** Published package metadata and bundled skill instructions should agree with generated behavior.

| # | Severity | File | Issue | Flagged by |
|---|----------|------|-------|------------|
| 1 | Low | `skills/howells-boundaries/SKILL.md:27` | Skill documents platform tags the CLI does not emit. | senior-engineer |
| 2 | Low | `src/output.js:25` | `problem` is an unused export and there is no dead-code gate. | senior-engineer |

**Suggested approach:** Decide whether platform tags are v1 scope. If not, update the skill and remove the unused export. If yes, add tag inference and tests.

### 3. Operational hygiene

**Why:** These are low-risk today, but they affect repeated local/CI use and agent-facing output behavior.

| # | Severity | File | Issue | Flagged by |
|---|----------|------|-------|------------|
| 1 | Low | `src/check.js:75` | JSON mode can buffer unbounded Turbo output. | performance-engineer |
| 2 | Low | `scripts/smoke-install.mjs:9` | Smoke install leaves temp projects and `node_modules` behind. | performance-engineer |

**Suggested approach:** Cap captured output with metadata and clean temp directories in `finally`.

---

<details>
<summary>Dismissed findings (0 items)</summary>

No reviewer findings were dismissed.

</details>

---

## Verification

| Check | Result |
|---|---|
| `npm test` | Passed, 14/14 |
| `npm run validate:skill` | Passed |
| `npm run smoke:install` | Passed |
| `npm pack --dry-run` | Passed; 13 files included |
| `node src/cli.js --schema` | Passed |
| `npm audit` high/critical scan | 0 |
| `npx -y knip --no-progress --reporter compact` | 1 unused export candidate |

## Next Steps

1. Fix workspace discovery safety first.
2. Add regression tests for unsafe `..` patterns and explicit workspace entries.
3. Clean up the skill/CLI tag mismatch and unused export.
