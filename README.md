# T3 Code + Copilot

This repo is a T3 Code fork that stays up to date with upstream and adds GitHub Copilot plus browser-local WebGPU support.

T3 Code is a minimal web GUI for coding agents. This fork supports Codex, GitHub Copilot, and a browser-side Local WebGPU adapter powered by Hugging Face Transformers.js.

## Preview

<img width="1792" height="1001" alt="2026-03-09_02-36-10" src="https://github.com/user-attachments/assets/2d2bb48f-1485-44e0-804e-468f4111d376" />
<img width="1912" height="1178" alt="image" src="https://github.com/user-attachments/assets/38cd4bb2-b27e-47e6-9565-d26c4c97fdd3" />

## This fork

- tracks upstream `pingdotgg/t3code`
- adds GitHub Copilot provider support
- adds a browser-side Local WebGPU provider for curated Hugging Face ONNX models
- keeps Codex support working too

## How to use

> [!WARNING]
> You need either [Codex CLI](https://github.com/openai/codex), GitHub Copilot, or a WebGPU-capable browser for the Local WebGPU adapter.

The easiest way to use this fork is the desktop app.

- Download it from the [releases page](https://github.com/zortos293/t3code-copilot/releases)
- Launch the app and choose `Codex`, `GitHub Copilot`, or `Local WebGPU`

You can also run it from source:

```bash
bun install
bun run dev
```

Open the app, connect your provider, and start chatting.

### Local WebGPU notes

- Local WebGPU runs entirely in the browser and does not use the server provider runtime.
- The first run downloads model files from Hugging Face/CDN endpoints and may take a while.
- Start with the curated small instruct models in Settings for the best chance of fitting browser memory limits.
- WebGPU availability depends on browser, OS, and GPU support. Recent Chromium-based browsers work best today.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
