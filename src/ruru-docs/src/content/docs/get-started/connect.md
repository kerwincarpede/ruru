---
title: Connect to Frigate
description: Point Ruru at your Frigate server and every camera appears on the wall.
sidebar:
  order: 2
---

Ruru needs one thing from you: the address of your [Frigate](https://frigate.video/) server. It reads the cameras and their streams from Frigate itself, so there are no stream URLs or camera passwords to enter.

## Connect

1. Open Ruru and choose **Connect to Frigate**.
2. In **Frigate URL**, enter the address you open Frigate at, such as `http://frigate.local:5000`.
3. Choose **Test connection**. Ruru shows the Frigate version and how many cameras it found, such as **Connected to Frigate 0.18.3, with 6 cameras.**
4. Choose **Save**.

Every camera appears on the wall and plays live, in Frigate's order. Next, [arrange the wall](/ruru/wall/arrange/) the way you want it.

:::caution[Use Frigate's unauthenticated port]
Ruru connects to Frigate's unauthenticated port, usually 5000. Logging in to Frigate's port 8971 is not supported yet. If Frigate runs in Docker, its container must publish port 5000. If only one computer runs Ruru, you can publish it to that computer alone, so the port stays off the rest of your network.
:::

## Change the server

Open **Settings** from the gear at the top right (it shows when you move the pointer), with `Ctrl+,` (`⌘ ,` on macOS), or from the menu you get by right-clicking the wall. Choose **Frigate**, change the address and choose **Save**.

Ruru remembers a separate layout for each Frigate server, so switching back brings your old wall back.

## New cameras

Ruru reads Frigate's camera list when it starts and again whenever its window comes back into focus. Add a camera to Frigate and it shows up on the wall. Remove one and its tile goes.
