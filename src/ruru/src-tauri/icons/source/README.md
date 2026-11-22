# App icon source

Every file in `../` is generated from `app-icon.svg`, the ruru (morepork owl) on a near full-bleed tile. Edit the SVG, then regenerate.

From `src/ruru/`:

```sh
npm run tauri icon src-tauri/icons/source/app-icon.svg -- -o /tmp/ruru-icons
```

Then copy over the files that already exist in `src-tauri/icons/` (skip the generated `android/`, `ios/` and `64x64.png`), and copy `32x32.png` to `public/icon.png` for the favicon.
