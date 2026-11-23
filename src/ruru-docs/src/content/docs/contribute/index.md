---
title: Contribute
description: Report a bug, suggest an idea, or build Ruru from source.
sidebar:
  label: Overview
  order: 0
---

Ideas and bug reports are welcome. [Open an issue](https://github.com/kerwincarpede/ruru/issues) to get started. Please don't attach pictures or video from your own cameras.

## Build from source

Ruru is built with Rust and [Tauri 2](https://tauri.app/), with a React and TypeScript frontend. [Developing Ruru](https://github.com/kerwincarpede/ruru/blob/main/docs/development.md) covers the prerequisites, running the app, the checks and how releases are made. In short, from the repository root:

```sh
npm ci
cd src/ruru
npm run tauri dev
```

## This site

These pages are a [Starlight](https://starlight.astro.build/) site in `src/ruru-docs/`. Every page has an **Edit page** link at the bottom. To run the site locally, from the repository root:

```sh
npm ci
cd src/ruru-docs
npm run dev
```

## Inspiration

Ruru is inspired by [CCTV Viewer](https://github.com/iEvgeny/cctv-viewer), a simple Qt app for watching many RTSP streams at once. Ruru takes the same idea and builds it around Frigate, so your cameras are found for you.
