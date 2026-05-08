# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — small markdown files describing changes that should be reflected in package versions and changelogs.

## Adding a changeset

```bash
pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major), and write a short summary. Commit the generated `.md` file alongside your code change.

## Releasing

On merge to `main`, the release workflow runs `changeset version` (bumps versions + writes changelogs) and `changeset publish` (publishes to npm). `NPM_TOKEN` must be configured as a GitHub Actions secret before the first publish.
