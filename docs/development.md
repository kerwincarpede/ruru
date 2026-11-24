# Developing Ruru

Ruru is built with Rust and [Tauri 2](https://tauri.app/), with a React + TypeScript frontend. This page covers building it from source, running the checks, and how releases are made.

## Layout

| Path | Contents |
| --- | --- |
| `package.json` | npm workspace root over `src/*`; holds the one lockfile |
| `src/ruru/` | The Tauri project |
| `src/ruru/src/` | Frontend: React + TypeScript + Vite. `settings/` is the Settings dialog, `wall/` the camera wall, its layout and its go2rtc player |
| `src/ruru/src-tauri/` | Backend: Rust |
| `src/ruru/src-tauri/icons/` | App icons, generated from `icons/source/app-icon.svg` (see the README there) |
| `.github/workflows/release.yml` | Edge releases for code pushes to `main` |
| `.github/workflows/promote.yml` | Makes a chosen Edge release Stable |
| `.github/workflows/docs.yml` | Builds the docs site and publishes it to GitHub Pages |
| `src/ruru-docs/` | The [docs site](https://kerwincarpede.github.io/ruru/), in [Starlight](https://starlight.astro.build/) |
| `AGENTS.md` | The rules every change follows, and which standard to read for which task |
| `docs/standards/` | The Rust, frontend, writing and PR standards |
| `docs/issues/` | Known problems being investigated, such as [Linux playback](issues/linux-playback.md) |
| `docs/investigations/` | Measurements behind a fix, such as [Linux streaming glitches](investigations/linux-streaming-glitches.md) |

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

### Connecting to Frigate

Ruru needs a Frigate server to show anything. Choose **Connect to Frigate**, enter the server's unauthenticated address (port 5000 by default), and **Save**. The Rust backend fetches `/api/version`, `/api/config` and `/api/go2rtc/streams` itself, because Frigate sends no CORS headers. Video and snapshots go from Frigate straight to the webview: WebRTC over `/live/webrtc/api/ws` first, then MSE over `/live/mse/api/ws`, and snapshots from `/api/<camera>/latest.webp`.

For each camera, Ruru takes the main and sub go2rtc streams from `live.streams` when it names more than one; otherwise from the `rtsp://127.0.0.1:8554/<name>` paths of the `record` (main) and `detect` (sub) inputs; otherwise `<camera>` and `<camera>_sub` when go2rtc has them. A camera with one stream uses it for both.

Settings are saved as `settings.json` in the app config folder (for example `~/.config/com.kerwincarpede.ruru/` on Linux). Delete it to start again from **Connect to Frigate**.

On Linux, WebKitGTK ships with WebRTC turned off, so Ruru turns it on for the main window at startup (`src-tauri/src/webview.rs`). A WebKitGTK built without WebRTC plays over MSE instead.

The frontend tests fake the backend with `mockCommands` and stub `WebSocket`, `RTCPeerConnection` and `MediaSource`; the Rust tests parse trimmed copies of Frigate's answers in `src-tauri/src/frigate/fixtures/`. No test needs a Frigate server.

### Fake updates

To see the update prompt without a newer release, set `RURU_FAKE_UPDATE` in a debug build. `1` offers version 99.0.0; any other value is the version offered:

```sh
RURU_FAKE_UPDATE=1 npm run tauri dev
```

Choosing **Install and restart** on a fake update only closes the prompt. With **Settings → Home Assistant** on, the device's **Update** entity offers the same version, and **Install** there saves `full_screen: true` in `settings.json` without restarting, so the relaunch setting can be checked without a newer release. With **Install updates automatically** on, each automatic check shows **Installing Ruru 99.0.0. Ruru will restart in a moment.** and installs nothing, so the notice stays until Ruru is restarted by hand. Release builds ignore the variable.

To build an installer for your platform:

```sh
cd src/ruru
npm run tauri build
```

### Ubuntu host controls

The Linux Tauri overlay includes the user agent unit and the managed wall unit only in the `.deb`. The agent runs the packaged binary with `--host-agent` without creating a Tauri window. Open an installed Ubuntu build in a GNOME Wayland session to exercise **Settings → Home Assistant → Enable host controls**.

Use a disposable GNOME Wayland machine, a separate MQTT 5 account scoped to the agent topics, Home Assistant, and synthetic Frigate streams for verification. Verify the display state after local input as well as after a command. Exercise local opening, a remote stop then start, and the three updater paths. Check that the service’s main PID changes once per relaunch, remains inside `ruru.service`, and that CPU sampling starts over. Check that turning the feature off restores the previous service and GNOME autostart files. Use `systemctl --user status ruru.service ruru-host-agent.service` and the user journal to diagnose failures.

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

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request except those that change only docs (the site, `docs/` or Markdown), and never publishes anything. Release builds call it through `workflow_call` with a `version` and a draft `release_id`.

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

## Docs site

The user guide at [kerwincarpede.github.io/ruru](https://kerwincarpede.github.io/ruru/) is a [Starlight](https://starlight.astro.build/) site in `src/ruru-docs/`, a workspace of the root `package.json`. Its pages are Markdown in `src/ruru-docs/src/content/docs/`, and the sidebar groups them by folder (`astro.config.mjs`). The landing page, `src/pages/index.astro`, is its own Astro page. Its wall of tiles plays CSS test patterns, never camera video. Both share the colours in `src/styles/tokens.css`, taken from the app's.

Run it from `src/ruru-docs/` (Astro needs Node 22.23.4 or later):

```sh
npm run dev      # http://localhost:4321/ruru/
npm run build    # into dist/
```

[`.github/workflows/docs.yml`](../.github/workflows/docs.yml) builds the site on pull requests that touch it, and publishes it to GitHub Pages when such a change reaches `main`. Changes only to the site, `docs.yml`, `docs/` or Markdown are not released as an Edge build, and CI skips them. A change to the site's dependencies also changes `package-lock.json`, which CI and the release still run for.

## Releases

`install.sh` at the repository root is the Linux one-line installer from the README. It reads the latest Stable release from the GitHub API (or the tag in `RURU_VERSION`) and picks the installer by matching the asset names above, so renaming the Linux installers means updating its patterns. Check it with `sh -n install.sh` and by running it in an Ubuntu container.

Each non-docs push to `main`, such as a merged code pull request, is released as an Edge build: a [GitHub release](https://github.com/kerwincarpede/ruru/releases) of that commit, marked as a pre-release and never as the latest release, with the installers attached (`.msi` and `-setup.exe` for Windows, a universal `.dmg` for macOS, and `.AppImage`, `.deb` and `.rpm` for Linux). Copies on the Edge update channel offer it. A Stable release is an Edge release promoted later, with the same installers (see [Promoting to Stable](#promoting-to-stable)), and Stable copies offer only those.

[`.github/workflows/release.yml`](../.github/workflows/release.yml) has three jobs:

| Job | What it does |
| --- | --- |
| Version | Reserves the next version and opens a draft release for it |
| CI | Runs `ci.yml` with that `version` and `release_id`: every check, and installers for all four platforms uploaded into the draft |
| Publish release | Writes `latest.json`, attaches it, and publishes the draft as an Edge pre-release, which creates its tag |

Only the short Version job runs one at a time (`queue: max`); two installer pipelines can run together. Every code merge keeps its release, even if a later one finishes first.

To force a bump the commits would not give, or to retry a failed release, open **Actions → Release → Run workflow**, or from a terminal:

```sh
gh workflow run release.yml -f bump=minor  # force patch, minor or major
gh run watch                               # follow it
```

A release runs only from `main`, and refuses a commit that is already released.

### Versions

Versions come from published `v*` tags and from drafts that reserve versions for builds still running. [`.github/scripts/release_version.py`](../.github/scripts/release_version.py) walks main's first-parent history from the nearest reservation, skipping docs-only commits, so each code merge takes its own version in commit order. The default `auto` bump takes the highest [Conventional Commits](https://www.conventionalcommits.org/) bump from the commit message and any commits it merges, including the subjects GitHub lists in a squash message:

| Conventional Commit marker | Bump |
| --- | --- |
| `!` after the type, or a `BREAKING CHANGE:` footer | major |
| `feat:` | minor |
| anything else | patch |

The first release takes the version in `src/ruru/src-tauri/tauri.conf.json`. CI stamps the reserved version into `tauri.conf.json` before building, so no version field is bumped by hand.

A failed run leaves a hidden draft that keeps its version. Retrying that commit with `auto` replaces the draft and keeps the version; other commits never take it. Each release is named by its version, for example `0.2.1` for the tag `v0.2.1`, and its notes open with a one-line **Edge build** paragraph.

Before publishing, the workflow cleans up GitHub's generated **What's Changed** list: it removes Conventional Commits prefixes and skips `ci`, `docs`, `chore`, `build`, `refactor`, `style` and `test` entries. Releases are immutable once published, so every asset, `latest.json` included, is attached first.

### Promoting to Stable

[`.github/workflows/promote.yml`](../.github/workflows/promote.yml) makes an Edge release the latest release, which Stable copies update to. Nothing is rebuilt. Run it from `main` with **Actions → Promote to Stable → Run workflow**, or:

```sh
gh workflow run promote.yml                  # the newest Edge release
gh workflow run promote.yml -f version=0.2.1 # a chosen one
```

It runs in the `stable` environment, which only `main` may deploy to and which waits for the owner's approval. [`.github/scripts/promote.py`](../.github/scripts/promote.py) picks the newest `v*` pre-release when no version is given, and refuses a draft or any version not newer than the current Stable release. [`.github/scripts/check_manifest.py`](../.github/scripts/check_manifest.py) checks that the release's `latest.json` has the right version and a signed HTTPS package for every platform. The workflow then drops the **Edge build** line from the notes and marks the release as the latest and no longer a pre-release.

### Updates

Installed copies update themselves with Tauri's [updater plugin](https://v2.tauri.app/plugin/updater/), driven from Rust (`src/ruru/src-tauri/src/update.rs`): `check_update` checks and keeps the update it finds, and `install_update` downloads and installs the package for the platform and installer type, then restarts Ruru. The page (`src/ruru/src/app/updates.ts`) checks once at startup. When there is a newer version, Ruru shows **Ruru \<version\> is ready. Install and restart?** with **Install and restart** and **Not now**. Not now closes the prompt until the next launch. A failed startup check shows nothing.

The channel is **Settings → Updates** (`updateChannel` in `settings.json`, `stable` or `edge`; anything else reads as Stable). Stable reads the latest release's manifest, `https://github.com/kerwincarpede/ruru/releases/latest/download/latest.json` (also `plugins.updater.endpoints` in `tauri.conf.json`). Edge asks `https://api.github.com/repos/kerwincarpede/ruru/releases` for the highest published `v<version>` release with a `latest.json`, Stable ones included, and reads `releases/download/v<version>/latest.json`. It skips drafts, other tags and pre-release versions, so a build that finishes late never moves Edge backwards. Only a newer version counts as an update, so a copy moved from Edge back to Stable keeps its version until Stable passes it. Switching channel (`set_update_channel`) forgets the update the old channel offered and checks the new one at once; `install_update` refuses an update found on a channel that is no longer picked. **Settings → Updates** shows a failed check's reason and **Check for updates** checks again. **Edit layout**, **Settings → Updates** and the footer before a server is connected show the version, with **· Edge** on the Edge channel.

**Install updates automatically** in **Settings → Updates** (`autoUpdate` in `settings.json`, off by default) hands updates to Rust. `start_auto_updates` runs a thread that checks the saved channel at startup, every 6 hours (`AUTO_CHECK_INTERVAL`) and whenever `set_auto_update` turns it on; each check does nothing while the setting is off. When it finds an update it installs it and restarts Ruru; a failed install waits for the next check. Every install, whether from this thread, **Install and restart** or Home Assistant, emits `update-status` as it goes: `{"state": "downloading", "version", "percent"}` (`percent` is null until the size is known), then `{"state": "installing", "version"}`, or `{"state": "failed", "version", "message", "automatic"}`. The page shows those as a notice over the bottom of the window in place of the prompt, and skips its own startup check while the setting is on. The thread takes the pending update to install it, as **Install and restart** and Home Assistant do, so the same update is never installed twice. A failed install stays pending.

A release builds the update packages because CI turns on `bundle.createUpdaterArtifacts` when it stamps the version: the `.app.tar.gz` on macOS, and the installers themselves elsewhere, each with a `.sig`. The publish job writes `latest.json` from those signatures ([`.github/scripts/updater_manifest.py`](../.github/scripts/updater_manifest.py)) and refuses to publish a release that is missing macOS, Linux or Windows.

### Signing

Releases run in the `release` environment, which only `main` may deploy to. Its secrets:

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The updater key. The updater accepts only packages signed with it; its public half is `plugins.updater.pubkey` in `tauri.conf.json` |
| `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD` | The "Ruru Self-Signed Code Signing" certificate, a base64 `.p12`, and its password |

Pull request builds get neither, so they make no update packages and sign the macOS app ad-hoc.

macOS remembers permissions and keychain access by an app's signature. An ad-hoc signature is tied to one exact build, so every update would look like a new app; the certificate gives every release the same identity. Tauri's own `APPLE_CERTIFICATE` import accepts only Apple-issued certificates, so CI imports this one into a temporary keychain itself, hands its name to Tauri as `APPLE_SIGNING_IDENTITY`, and fails the build if the signature is not tied to it. An `APPLE_SIGNING_IDENTITY` secret (a paid certificate) would take precedence. The certificate was made once with [`.github/scripts/make_macos_signing_cert.sh`](../.github/scripts/make_macos_signing_cert.sh), valid for 20 years.

**Never regenerate either one.** A new updater key strands every installed copy, which then has to be updated by hand; a new certificate makes macOS treat Ruru as a new app. The owner keeps the backups in `~/.ruru-signing/`: `updater.key`, `updater.key.pub` and `updater.password` for the updater key, and `ruru-signing.p12`, `ruru-signing.password` and `cert.pem` for the certificate.
