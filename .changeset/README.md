# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — small markdown files describing changes that should be reflected in package versions and changelogs.

## Adding a changeset

```bash
pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major), and write a short summary. Commit the generated `.md` file alongside your code change.

## Releasing

A single workflow (`.github/workflows/release.yml`) handles two flows:

- **Alpha** — on every push to `main`, queued changesets drive a snapshot publish. Each affected package gets a `<currentVersion>-alpha-<N>` version (counter incremented per publish; resets on the next `latest`). Queued `.md` files are **not** consumed; they stay around for the next `latest`.
- **Latest** — triggered manually via the Actions UI (`workflow_dispatch`). The workflow runs `changeset version` (consuming queued changesets), commits the bumps + CHANGELOGs to `main`, publishes each bumped package with the default `latest` tag, and opens one GitHub Release per package.

Publishing uses npm [trusted publishers](https://docs.npmjs.com/trusted-publishers) (OIDC). No `NPM_TOKEN` secret is configured — each package's npmjs.com settings must list this repo + `release.yml` as a trusted publisher (one-time setup per package).
