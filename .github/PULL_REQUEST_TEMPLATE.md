# Description

<!-- What does this change, and why? Link any related issue. -->

Closes #

## Type of change

<!-- Mark all that apply. The commit type drives the released version. -->

- [ ] `fix:` — bug fix (patch release)
- [ ] `feat:` — new feature (minor release)
- [ ] `feat!:` / `BREAKING CHANGE:` — breaking change (major release)
- [ ] `perf:` — performance improvement (patch release)
- [ ] `docs:` — documentation only (no release)
- [ ] `refactor:` / `style:` / `test:` / `chore:` / `ci:` / `build:` — no release

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
      (enforced by commitlint)
- [ ] `pnpm check` passes (format, lint, typecheck)
- [ ] `pnpm test` passes, and new behavior has tests
- [ ] `pnpm size:check` still fits the 5 kB budget
- [ ] Public API changes are reflected in the README and `docs/`
- [ ] New public functions have JSDoc

## Bundle size

<!-- Paste the `pnpm size:check` output if this affects the bundle. -->

```
Size limit: 5 kB
Size:
```

## Testing

<!--
How was this verified? For storage behavior, say which backends you covered
('local' / 'session' / 'in-memory') and whether you checked a real browser.
-->

## Notes for reviewers

<!-- Anything tricky, deliberately out of scope, or worth a closer look. -->
