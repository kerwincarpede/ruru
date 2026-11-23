# Writing standards

This covers UI text, `docs/`, the README and PR titles.

## Voice

- Plain words, short sentences, written to the person using it: "Enter your Frigate address."
- Use British spelling in prose: colour, licence, organise. Code identifiers keep their own spelling (`color` in CSS and TypeScript).
- Name UI elements exactly as they appear, in bold: **Install and restart**, **Not now**.
- Write keys as they are labelled, in code: `F11`, `⌘ Q`. Give each platform's key where they differ.

## Keep the docs true

- A change users can see updates the README in the same PR if it changes what the README says.
- It also updates the matching page on the [docs site](https://kerwincarpede.github.io/ruru/), in `src/ruru-docs/src/content/docs/`.
- A change to how something is built, run or released updates `docs/development.md`.
- Describe what Ruru does today. Check every claim against the code, and leave out plans and history.

## PR titles

- Give PR titles a Conventional Commits prefix and a short description a user would understand, such as `feat: Show cameras from Frigate` or `fix: Reconnect a tile after the network drops`. Keep the prefix in the commit message when merging so the release can pick the version bump.
- Release notes show the description without the prefix, and omit `ci`, `docs`, `chore`, `build`, `refactor`, `style` and `test` entries.
