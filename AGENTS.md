# AGENTS.md

Ruru is a Tauri 2 desktop app that shows every Frigate camera live on one screen, on Windows, macOS and Linux: a Rust backend in `src/ruru/src-tauri/` and a React + TypeScript frontend in `src/ruru/src/`. The root is an npm workspace with the one lockfile.

## Rules that are never broken

- **Every merge to `main` ships.** Nothing lands with a failing check. Merge only what is ready for users.
- **Three platforms, every time.** Code must build and behave on Windows, macOS and Linux (X11 and Wayland). Platform code sits behind `#[cfg(...)]` with a fallback for the others.
- **Nothing new leaves the computer silently.** Ruru talks only to the user's Frigate server and checks GitHub releases for updates. No analytics, no telemetry, no cloud account. Any new network request is added to this rule in the same PR.
- **Never show the user's real cameras.** Screenshots, recordings and other evidence never show video or snapshots from the user's own cameras. Capture them against a stand-in Frigate that serves synthetic test-pattern streams.
- **Never touch the signing setup.** Leave the updater key, the macOS certificate and their secrets alone, and never regenerate them. Losing them strands every installed copy.
- **Keep startup thin.** `lib.rs` `run()` only wires modules together; logic lives in modules with their own tests.

## Checks

Run these before you push. CI runs the same ones:

```sh
npm ci                                   # repository root
python3 -m unittest discover .github/scripts
cd src/ruru
npm run lint && npm run test:coverage && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run test:coverage` fails below 90% of lines or 83% of branches. CI runs the Rust tests under `cargo llvm-cov`, which needs the `llvm-tools-preview` rustup component, instead of `cargo test`, and fails below 61% of lines.

## CI

`.github/workflows/ci.yml` runs Checks on Linux, the Rust tests on Windows and macOS, and builds the app on four runners. Ordinary PRs link the app without installers; PRs that change packaging inputs (`src-tauri/` outside `src/` and `tests/`, `.github/scripts/`, the workflows, package files) build and upload installers. Force packaging with `gh workflow run ci.yml --ref <branch> -f package=true`. See [docs/development.md](docs/development.md#ci).

## Releases

Every non-docs merge to `main` runs `.github/workflows/release.yml`, which publishes a signed Edge pre-release with `latest.json`. `.github/workflows/promote.yml` makes a chosen Edge release Stable after the owner approves it. Installed copies check only Stable at startup. The signing secrets live in the `release` environment, with backups in `~/.ruru-signing/`. See [docs/development.md](docs/development.md#releases).

## Read before you start

Load only what the task touches.

| When you are... | Read |
| --- | --- |
| Changing Rust in `src-tauri/` | [docs/standards/rust.md](docs/standards/rust.md) |
| Changing the frontend in `src/ruru/src/` | [docs/standards/frontend.md](docs/standards/frontend.md) |
| Writing UI text, docs or a PR title | [docs/standards/writing.md](docs/standards/writing.md) |
| Branching, committing or opening a PR | [docs/standards/pull-requests.md](docs/standards/pull-requests.md) |
| Changing releases, promotion, signing or updates | [docs/development.md](docs/development.md#releases) |
| Setting up or running the app | [docs/development.md](docs/development.md) |
