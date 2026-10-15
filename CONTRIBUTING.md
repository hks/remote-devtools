# Contributing

Thanks for helping out! Bug reports, ideas, documentation fixes and code are all welcome.

## Before you start

- For bugs and small fixes, open a pull request directly or file an issue first if you are unsure.
- For new modules, protocol changes or larger features, please open an issue to discuss the design first. The protocol
  is shared by every SDK, so changes there need extra care.
- Security problems: please follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Setup

Requirements: Node 24+ and pnpm (`corepack enable`).

```bash
pnpm install
pnpm typecheck && pnpm test
```

The [development guide](https://hks.github.io/remote-devtools/maintainers/development) explains the layout, the dev
servers and the fake device you can use instead of a phone.

## Pull requests

- Keep changes focused; unrelated refactors are easier to review separately.
- Add or update tests: relay behaviour in `packages/relay/test`, SDK behaviour in `packages/sdk-js/test` (both run
  against a real relay).
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` before pushing; CI runs the same.
- Formatting and linting use [Biome](https://biomejs.dev): `pnpm format` fixes what it can. The repository recommends the
  Biome editor extension with format on save. Keep comments short and about why.
- If your change affects the published SDK or protocol packages, add a changeset with `pnpm changeset` and describe the
  change for users.
- Update the documentation in `docs/` when behaviour or APIs change.

## Code of conduct

Be kind and assume good intent. Harassment or personal attacks are not tolerated in issues, pull requests or any other
project space; maintainers may remove such content and block those responsible.
