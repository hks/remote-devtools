# Releasing

| Artifact | Where | How |
|---|---|---|
| `@himmetkaan/remote-devtools`, `@himmetkaan/remote-devtools-protocol` | npm | [Changesets](https://github.com/changesets/changesets) + the `Release` workflow |
| Relay + UI image | `ghcr.io/hks/remote-devtools` | The `Docker image` workflow, on version tags |
| Documentation | GitHub Pages | The `Docs` workflow, on every push to `main` |
| Desktop app | GitHub Releases | Built locally for now; see [macOS signing](./macos-release) |

The relay and the UI are not published to npm; they ship inside the Docker image and the desktop app.

## npm packages

1. With every user-facing change, add a changeset and commit it with the change:

   ```bash
   pnpm changeset
   ```

   The SDK and the protocol package are versioned together.

2. When changesets reach `main`, the `Release` workflow opens (or updates) a **Version packages** pull request that
   bumps versions and writes the changelogs.

3. Merging that pull request publishes the new versions to npm with provenance.

The workflow needs an `NPM_TOKEN` repository secret: an npm **granular access token** with read and write access to
the `@himmetkaan` packages. Prereleases can be made with `pnpm changeset pre enter alpha`.

::: info Keep `SDK_VERSION` in sync
`packages/sdk-js/src/client.ts` reports `SDK_VERSION` in every `hello`. The `version` script updates it from
`package.json`; a test fails if they differ.
:::

## Docker image

Push a tag like `v0.2.0` to build and publish `ghcr.io/hks/remote-devtools:0.2.0` and `:latest` for `linux/amd64` and
`linux/arm64`. The workflow uses the built-in `GITHUB_TOKEN`; no secret is needed. After the first push, make the
package public in the repository's **Packages** settings.

## Documentation

The `Docs` workflow builds this site and deploys it to GitHub Pages. Enable Pages once in the repository settings with
**Source: GitHub Actions**. Preview locally with `pnpm docs:dev`.
