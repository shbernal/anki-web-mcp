# Contributing

Issues and pull requests are welcome, including fully AI-generated ones.

## Disclosure

If a change was produced with an AI harness, say so in the issue or pull request:
which harness and which model. That is the whole requirement. It is not a mark
against the contribution, it is context for reviewing it.

## Getting set up

```sh
pnpm install
pnpm exec lefthook install
pnpm exec playwright install chromium
```

The package manager version is pinned in `package.json`. Use it rather than a
different one. The test suite drives no real browser and makes no request to
AnkiWeb, so Chromium is only needed to run the server by hand.

## Gates

Five, and CI runs them by name:

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

`lefthook` runs formatting and linting on staged files before a commit, and lint,
typecheck and test before a push.

## AnkiWeb changes

AnkiWeb has no published API, so the server follows what its frontend does.
[docs/ankiweb.md](docs/ankiweb.md) records every endpoint and field number used,
and the fixtures under `test/fixtures/ankiweb/` are recorded response bodies. A
fix for a change on AnkiWeb's side updates the doc, the field tables in
`src/ankiweb/` and the fixtures together.

Never commit a fixture holding a cookie, an account email or a deck that is not
public.

## Conventions

- Node >= 24, ESM, TypeScript 7.x.
- oxlint and oxfmt, not ESLint and Prettier. `.oxlintrc.json` runs all five
  categories, `pedantic` and `style` included. Every exemption in it carries the
  reason it is there. Read those before adding one, and write yours the same way.
- A tool that changes something other people can see previews first and acts
  only with `confirm: true`. [docs/sharing.md](docs/sharing.md) is the worked
  example.
- Comments describe what the code does now. They are not a log of what it used
  to do.
