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

To run the release script tests, from the repository root:

```sh
python3 -m unittest discover .github/scripts
```

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request except those that change only docs (`docs/` or Markdown), and never publishes anything. Release builds call it through `workflow_call` with a `version` and a draft `release_id`.

| Job | Runs on | What it does |
| --- | --- | --- |
| Checks | Ubuntu 24.04 | `npm run lint`, the release script tests, `npm run test:coverage`, `npm run build`, `cargo fmt --check`, `cargo clippy` with warnings as errors, and the Rust tests under `cargo llvm-cov` |
| Rust tests | Windows and macOS | `cargo test`, so code behind `#[cfg(windows)]` and `#[cfg(target_os = "macos")]` is tested as well as built |
| build-route | Ubuntu 24.04 | Decides whether the Build jobs package installers |
| Build | Ubuntu 24.04 (x86_64 and arm64), Windows, macOS (universal) | Builds the app on each platform |

Checks measures coverage while it runs the tests. `npm run test:coverage` fails below 90% of lines or 83% of branches. `cargo llvm-cov` (pinned in `ci.yml`, and needing the `llvm-tools-preview` rustup component) prints a line summary in the job log and fails below 61% of lines (1 point below the coverage measured when the floor was set; raise it as Rust code gains tests). The HTML and lcov reports for both are uploaded as one `coverage` artifact, even when a test or a floor fails.

On Windows, Tauri embeds the Common Controls 6 manifest only in the app, so the test executables would fail to start. `build.rs` turns that off and has the linker embed `windows-app-manifest.xml`, the same manifest, in every binary instead.

### Packaging

Ordinary pull requests link the native app with `tauri build --no-bundle` and produce no installers. [`.github/scripts/packaging_route.sh`](../.github/scripts/packaging_route.sh) switches a pull request to full packaging when it changes a packaging input:

- anything in `src/ruru/src-tauri/` outside `src/` and `tests/` (such as `tauri.conf.json`, `Cargo.toml`, icons and `build.rs`), or a binary in `src/bin/`
- `.github/scripts/` or a workflow
- a `package.json`, `package-lock.json`, `.cargo/` or `.gitattributes`

A packaging build runs `tauri-action` and uploads the installers as one artifact per runner (`ruru-<runner>`): `.deb`, `.rpm` and `.AppImage` for Linux, `.msi` and `-setup.exe` for Windows, and a universal `.dmg` for macOS.

To force packaging for any branch, open **Actions → CI → Run workflow** on GitHub and leave **Build and upload installers on every platform** ticked, or from a terminal:

```sh
gh workflow run ci.yml --ref my-branch -f package=true
```

Linux dependencies are downloaded by [`.github/scripts/install_linux_deps.py`](../.github/scripts/install_linux_deps.py) from the Ubuntu archive (ports on arm64), with a 120-second limit for index updates and 180 seconds for package downloads per attempt. A failure tries a second mirror (the runner's original ports source on arm64). Downloads finish before installation, so a timeout never interrupts dpkg.

Release builds run the Build jobs in the `release` environment, which holds the updater signing key and the macOS signing certificate. They stamp the release version into `tauri.conf.json`, sign the macOS app with the "Ruru Self-Signed Code Signing" certificate and check that its signature is tied to that certificate, and upload the installers to the draft release. Other builds get none of those secrets.
