# Changelog

## 0.1.6 - 2026-07-21

### Added

- Add repository lint and formatting commands backed by `@howells/lint`.

### Changed

- Run Turbo boundary checks from a disposable filtered mirror when gitignored
  paths need to be excluded, keeping the original working tree untouched
  throughout the check.

### Fixed

- Treat Turbo processes terminated by a signal as failed checks instead of
  allowing a null exit code to appear successful, and preserve the signal in
  JSON output.
- Omit ignored caches, files, symlinks, and special files repository-wide;
  materialize safe internal symlinks; reject escaping symlinks; and keep mirror
  storage outside the source repository.
- Fail closed when Git cannot provide ignore information instead of running
  Turbo against an unfiltered working tree.
- Validate complete `name` and `description` frontmatter keys in the bundled
  Codex skill rather than treating frontmatter as a set of characters.
