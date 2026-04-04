# T3 Code + Copilot
## This repo will soon get an update that makes it upstream again

This repo is a T3 Code fork that stays up to date with upstream and adds GitHub Copilot support.

T3 Code is a minimal web GUI for coding agents. This fork supports Codex, GitHub Copilot, and Claude Code.

## Preview

<img width="1792" height="1001" alt="2026-03-09_02-36-10" src="https://github.com/user-attachments/assets/2d2bb48f-1485-44e0-804e-468f4111d376" />
<img width="1912" height="1178" alt="image" src="https://github.com/user-attachments/assets/38cd4bb2-b27e-47e6-9565-d26c4c97fdd3" />

## This fork

- tracks upstream `pingdotgg/t3code`
- adds GitHub Copilot provider support
- keeps Codex support working too
- keeps the upstream Claude Code work in the merge

## How to use

> [!WARNING]
> You need to have Codex CLI, GitHub Copilot, or Claude Code available and authorized for T3 Code to work.
> When you run T3 Code from source, `bun install` is enough for Copilot support because `apps/server` already depends on `@github/copilot` and `@github/copilot-sdk`.
> If you want to use GitHub Copilot CLI directly in a terminal, follow GitHub's [Copilot CLI installation guide](https://docs.github.com/copilot/how-tos/set-up/install-copilot-cli). If Copilot comes from an organization or enterprise, the Copilot CLI policy must be enabled there.

## Copilot setup

For the app itself, there is no separate global Copilot install step when running from source:

```bash
bun install
```

If you are using Copilot CLI directly in your terminal, install it with GitHub's docs and sign in from a trusted folder. On first launch, Copilot will prompt you to use `/login` if you are not already authenticated.

The easiest way to use this fork is the desktop app.

- Download it from the [releases page](https://github.com/zortos293/t3code-copilot/releases)
- Launch the app and choose either `Codex` or `GitHub Copilot`

You can also run it from source:

```bash
bun install
bun run dev
```

Open the app, connect your provider, and start chatting.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
