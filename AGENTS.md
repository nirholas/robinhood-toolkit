# AGENTS.md

Operating notes for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository. Everything here is derived from the files actually in the tree, so trust it over guesses, and update it when the facts change.

## What this repository is

Build on Robinhood Chain and Robinhood Crypto: verified network constants, a chain SDK, a read-only MCP server, runnable examples, and 64 build prompts.

- Homepage: https://nirholas.github.io/robinhood-toolkit/
- Source: https://github.com/nirholas/robinhood-toolkit
- Primary language: Solidity
- License: Other (see the LICENSE file)

## Repository layout

- `apps/`
- `clients/`
- `config/`
- `deploy/`
- `dex/`
- `docs/`
- `examples/`
- `foundry/`
- `packages/`
- `prompts/`
- `registry/`
- `reports/`
- `rh-charts/`
- `rh-first-deploy/`
- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `package.json`

Tests live in `test/`. Add or update a test next to the code you change.

## Setup

```bash
npm install
```

## Commands

| Task | Command |
|---|---|
| test | `npm test` |

Run the test and lint commands above before you consider a change finished. If a command fails on code you did not touch, say so in your report instead of silently skipping it.

## Conventions

- This is a monorepo (`workspaces` in `package.json`); run scripts from the root unless a package README says otherwise.
- `.env` files are gitignored; never commit credentials, and read configuration from environment variables.
- Read `CONTRIBUTING.md` before opening a pull request.
- Read the surrounding code before adding to it, and match its naming, file organisation and error-handling style.
- Keep `README.md` accurate: if a change alters behaviour, commands or configuration, update the docs in the same commit.
- Do not leave TODO comments, stub functions, placeholder data or commented-out code behind. Finish what you start or leave it out.
- Small, focused commits with a subject line that describes the change, not the act of committing.

## Where to raise things

- Bugs and feature requests: https://github.com/nirholas/robinhood-toolkit/issues
- Questions and ideas: https://github.com/nirholas/robinhood-toolkit/discussions
- Security issues: follow `SECURITY.md`, never a public issue.
