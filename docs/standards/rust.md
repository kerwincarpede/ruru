# Rust backend standards

These apply to `src/ruru/src-tauri/`. Each feature gets its own module in `src/`. `lib.rs` wires them into the app and stays thin.

## Commands

- A `#[tauri::command]` lives in the module it belongs to and is only reachable once it is listed in `generate_handler!` in `lib.rs`.
- Commands that can fail return `Result<T, String>`, so the frontend gets a message it can show. Inside a module, use a typed error and turn it into a `String` at the command.
- Send bytes as `tauri::ipc::Response`, not as a JSON array.
- Check arguments from the page before using them. The page is not trusted to send sane values.
- A struct that crosses the bridge derives `Serialize` (and `Deserialize` when the page sends it) and names its TypeScript mirror in its `///` comment. Change both sides in the same PR.

## Windows and capabilities

- A new window label has to match a pattern in `capabilities/*.json`, or the window's page can't call anything.
- Add a permission to a capability only when a window needs it, and only to that window's capability.

## Platforms

- Put platform-specific code behind `#[cfg(target_os = "...")]`, and give the other platforms a `#[cfg(not(...))]` fallback so all three still compile.
- Never block the main thread with network or file I/O.

## Style

- `cargo fmt` and `cargo clippy --all-targets -- -D warnings` must be clean. Warnings fail CI.
- Give public items a `///` comment that says what they do and why, not how.
- Tests go in a `#[cfg(test)] mod tests` at the bottom of the module they test. They must run without a network, a display or a Frigate server.
- Debug switches are `RURU_*` environment variables. Document a new one in `development.md`.
