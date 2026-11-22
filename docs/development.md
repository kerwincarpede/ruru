# Developing Ruru

Ruru is built with Rust and [Tauri 2](https://tauri.app/), with a React + TypeScript frontend. This page covers building it from source and running the checks.

## Layout

| Path | Contents |
| --- | --- |
| `package.json` | npm workspace root over `src/*`; holds the one lockfile |
| `src/ruru/` | The Tauri project |
| `src/ruru/src/` | Frontend: React + TypeScript + Vite |
| `src/ruru/src-tauri/` | Backend: Rust |
| `src/ruru/src-tauri/icons/` | App icons, generated from `icons/source/app-icon.svg` (see the README there) |
| `AGENTS.md` | The rules every change follows, and which standard to read for which task |
| `docs/standards/` | The Rust, frontend, writing and PR standards |

## Prerequisites

1. Install [Node.js 22](https://nodejs.org/) and the stable Rust toolchain via [rustup](https://rustup.rs/), with `rustup component add rustfmt clippy`.
2. Install the Tauri system dependencies for your OS, see [Tauri prerequisites](https://tauri.app/start/prerequisites/). On Debian/Ubuntu:

   ```sh
   sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
     librsvg2-dev libxdo-dev libssl-dev patchelf build-essential curl wget file
   ```

3. Install the frontend dependencies from the repository root, which is an npm workspace over `src/*`:

   ```sh
   npm ci
   ```

## Run

```sh
cd src/ruru
npm run tauri dev
```

This starts Vite on port 1420 and opens the Ruru window. Frontend changes reload at once; Rust changes rebuild and restart the app.

To build an installer for your platform:

```sh
cd src/ruru
npm run tauri build
```

## Checks

Run these from `src/ruru/` before you push:

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint and `tsc --noEmit` |
| `npm run test` | The Vitest tests |
| `npm run test:coverage` | The Vitest tests, failing below 90% of lines or 83% of branches |
| `npm run build` | The frontend type-checks and bundles |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Rust formatting |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Rust lints, with warnings as errors |
| `cargo test --manifest-path src-tauri/Cargo.toml` | The Rust tests |

The coverage report is written to `src/ruru/coverage/`.
