<!--
PR title MUST follow Conventional Commits: it becomes the merge commit
message and the CHANGELOG line. Examples:
  feat(schema): add drag handle to canvas nodes
  fix(auth): clear sys_session cookie on 401
  feat!: remove deprecated /api/v0 client    (breaking change: a minor bump while the version is below 1.0)
-->

## Summary

<!-- What does this PR do, in 1-3 sentences? -->

## Why

<!-- What problem is this solving? Link issues with `Closes #123`. -->

## How

<!-- Notable implementation decisions or trade-offs reviewers should know about. -->

## Versioning impact

- [ ] `feat:`  → minor bump
- [ ] `fix:` / `perf:` / `deps:`  → patch bump
- [ ] `feat!:` / `fix!:` (BREAKING CHANGE)  → minor bump while below 1.0
- [ ] No version impact (`docs:`, `chore:`, `ci:`, `refactor:`, `test:`, `build:`, `style:`)

## Verification

- [ ] `pnpm run check` passes
- [ ] `pnpm run test` passes
- [ ] `pnpm run lint:ui` passes
- [ ] `pnpm run build` passes
- [ ] Manually exercised the affected admin screens
- [ ] Updated docs / README if behavior changed

## Screenshots

<!-- For UI changes, before/after screenshots or a short clip. -->
