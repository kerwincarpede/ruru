# Frontend standards

These apply to `src/ruru/src/`: React, TypeScript (strict) and Vite.

## Structure

- `App.tsx` is the window. As features arrive, each gets its own folder with its component, its `api.ts`, its CSS and its tests.
- `src/app/` holds what more than one feature shares. Move code there only when a second feature needs it.
- Put pure logic (layout maths, parsing) in its own `.ts` module with its own tests, apart from the component.

## Talking to Rust

- Only an `api.ts` calls `invoke`. Components call the typed functions it exports.
- An interface that mirrors a Rust struct says so: `/** Mirrors \`AppInfo\` in src-tauri/src/lib.rs. */`. Change both sides in the same PR.
- Command names are the Rust function names (`app_info`). Argument keys are camelCase, as Tauri expects.

## Styling

- Colours come from the tokens in `App.css` (`--bg`, `--text`, `--accent` and so on). Those tokens are redefined for dark mode. Never hard-code a colour that has a token, and check new UI in both light and dark.
- A feature's stylesheet builds on the shared tokens. It does not redefine them.
- Under `prefers-reduced-motion`, use `transition: none`.

## Tests

- Vitest with Testing Library. Test files sit beside the code as `*.test.ts(x)`.
- Fake the backend with `mockCommands` from `src/test/mockCommands.ts`, which wraps `mockIPC` and types each handler's result by Rust command name. Add a command there when the page starts calling it. It returns the calls the page made; assert on the commands and payloads the page sends. `src/test/setup.ts` clears mocks after each test.
- Test what a user does and sees (role, label, text), not component internals.
- `npm run lint` runs ESLint and `tsc --noEmit`. Both must pass with no `any` or disabled rules left behind.
