# T3 Code + Copilot

This fork starts from upstream `pingdotgg/t3code` and adds GitHub Copilot support on top.

T3 Code is a minimal web GUI for coding agents. This fork currently supports Codex, GitHub Copilot, and Claude.

## Installation

> [!WARNING]
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - GitHub Copilot: follow the [Copilot SDK local CLI setup guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/local-cli) and authenticate with GitHub
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/zortos293/t3code-copilot/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
