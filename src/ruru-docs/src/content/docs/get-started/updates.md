---
title: Updates
description: How Ruru keeps itself up to date, and the Stable and Edge update channels.
sidebar:
  order: 3
---

Ruru checks for a newer release each time it starts. When there is one, it says so, such as **Ruru 0.4.1 is ready. Install and restart?** Choose **Install and restart** to update, or **Not now** to carry on.

To check by hand, open **Settings → Updates** and choose **Check for updates**. The page also shows the version you have.

With **Settings → Home Assistant** on, Ruru also checks every 6 hours while connected, and Home Assistant can install the update. Ruru then restarts full screen. See [Home Assistant](/ruru/guides/home-assistant/#updates-from-home-assistant).

## Stable and Edge

Pick a channel with **Update channel** in **Settings → Updates**. Changes save as you make them.

- **Stable** (the default): get updates after they've been tried on Edge.
- **Edge**: get every change as soon as it's built. You may run into bugs. **Edit layout** and **Settings → Updates** show **Edge** next to the version, such as **Ruru 0.4.0 · Edge**.

Switching channel checks the new one straight away. Ruru never installs an older version, so moving from Edge back to Stable keeps the version you have until Stable passes it.

Every Edge build is also on the [releases page](https://github.com/kerwincarpede/ruru/releases) as a pre-release.
