import "./App.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { appInfo, type AppInfo } from "./app/api";
import { cameraLabel, type Camera } from "./app/frigate";
import { isMac, shortcutFor } from "./app/keys";
import Logo from "./app/Logo";
import { frigateCameras, getSettings, onFullScreenChanged, onOpenSettings, saveLayout, setFullScreen, type SavedLayout, type Settings } from "./app/api";
import UpdatePrompt from "./app/UpdatePrompt";
import { findUpdate, type AvailableUpdate } from "./app/updates";
import SettingsDialog from "./settings/SettingsDialog";
import { EMPTY_LAYOUT, showCamera, wallPlacements } from "./wall/layout";
import Wall from "./wall/Wall";
import WallMenu, { type MenuItem } from "./wall/WallMenu";

/** How long the toolbar stays after the pointer stops moving. */
export const TOOLBAR_HIDE_MS = 2500;

const NO_SETTINGS: Settings = { frigateUrl: null, fullScreen: false, layouts: {} };

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lockRatio, setLockRatio] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; camera?: string } | null>(null);
  const [live, setLive] = useState(() => document.visibilityState !== "hidden");
  const [toolbar, setToolbar] = useState(true);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = settings?.frigateUrl ?? null;

  useEffect(() => {
    appInfo()
      .then(setInfo)
      // Without the backend's answer the footer stays empty; nothing else depends on it.
      .catch(() => {});
  }, []);

  // One check per launch. findUpdate never rejects: a failed check offers nothing.
  useEffect(() => {
    let current = true;
    void findUpdate().then((found) => {
      if (current) setUpdate(found);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => setSettings(NO_SETTINGS));
  }, []);

  // Cameras come from Frigate at startup, after Save, and whenever the window regains focus.
  // A discovery still running for a server that is no longer saved is ignored.
  const currentUrl = useRef<string | null>(null);
  const discover = useCallback(
    (server: string) =>
      frigateCameras(server)
        .then(
          (found) => {
            if (currentUrl.current !== server) return;
            setCameras(found);
            setDiscoveryError(null);
          },
          (error: unknown) => {
            if (currentUrl.current === server) setDiscoveryError(String(error));
          },
        )
        .then(() => setRefresh((count) => count + 1)),
    [],
  );

  useEffect(() => {
    currentUrl.current = url;
    if (!url) return;
    void discover(url);
    const onFocus = () => void discover(url);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [url, discover]);

  // Streams stop while the window is hidden or minimised.
  useEffect(() => {
    const onVisibility = () => setLive(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const fullScreenRef = useRef(false);
  useEffect(() => {
    fullScreenRef.current = settings?.fullScreen ?? false;
  }, [settings]);
  const toggleFullScreen = useCallback(() => {
    const next = !fullScreenRef.current;
    fullScreenRef.current = next;
    setSettings((current) => ({ ...(current ?? NO_SETTINGS), fullScreen: next }));
    void setFullScreen(next).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === "settings") setSettingsOpen(true);
      else toggleFullScreen();
    };
    window.addEventListener("keydown", onKey);
    let current = true;
    const stops: (() => void)[] = [];
    const keep = (unlisten: () => void) => {
      if (current) stops.push(unlisten);
      else unlisten();
    };
    void onOpenSettings(() => setSettingsOpen(true)).then(keep);
    // Full screen also changes outside Ruru's toggle, such as the macOS green button.
    void onFullScreenChanged((fullScreen) => {
      fullScreenRef.current = fullScreen;
      setSettings((now) => ({ ...(now ?? NO_SETTINGS), fullScreen }));
    }).then(keep);
    return () => {
      current = false;
      window.removeEventListener("keydown", onKey);
      stops.forEach((stop) => stop());
    };
  }, [toggleFullScreen]);

  // The toolbar shows while the pointer moves, then fades away.
  const wake = () => {
    setToolbar(true);
    if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
    toolbarTimer.current = setTimeout(() => setToolbar(false), TOOLBAR_HIDE_MS);
  };
  useEffect(() => {
    toolbarTimer.current = setTimeout(() => setToolbar(false), TOOLBAR_HIDE_MS);
    return () => {
      if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
    };
  }, []);

  const layout = url ? settings?.layouts[url] : undefined;
  const changeLayout = (next: SavedLayout) => {
    if (!url) return;
    setSettings((current) => (current ? { ...current, layouts: { ...current.layouts, [url]: next } } : current));
    void saveLayout(url, next).catch(() => {});
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  const fullScreen = settings?.fullScreen ?? false;
  const wallItems: MenuItem[] = [
    { label: "Settings…", onSelect: () => setSettingsOpen(true) },
    ...(url && cameras?.length
      ? [{ label: editing ? "Done editing" : "Edit layout", onSelect: () => setEditing((now) => !now) }]
      : []),
    { label: fullScreen ? "Exit full screen" : "Enter full screen", onSelect: toggleFullScreen },
  ];
  const streamItems: MenuItem[] = [];
  const target = cameras?.find((camera) => camera.name === menu?.camera);
  if (target && cameras && target.mainStream !== target.subStream) {
    const tiles = wallPlacements(cameras.map((camera) => camera.name), layout);
    const current = tiles.find((tile) => tile.camera === target.name)?.stream;
    streamItems.push(...([undefined, "main", "sub"] as const).map((stream) => ({
      label: stream === "main" ? "Main stream" : stream === "sub" ? "Sub stream" : "Automatic stream",
      checked: stream === current,
      onSelect: () => changeLayout({
        hidden: layout?.hidden ?? [],
        tiles: tiles.map((tile) => tile.camera === target.name ? { ...tile, stream } : tile),
      }),
    })));
  }
  const settingsKey = isMac() ? "⌘ ," : "Ctrl+,";
  const hidden = layout?.hidden ?? [];
  const showToolbar = toolbar || editing || !url;

  return (
    <main
      className={`window${url ? " has-wall" : " placeholder"}${editing ? " is-editing" : ""}`}
      onPointerMove={wake}
      onContextMenu={(event) => {
        // Dialogs keep the webview's own menu, such as Paste in the URL field.
        if ((event.target as Element).closest('[role="dialog"]')) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, camera: (event.target as Element).closest<HTMLElement>("[data-camera]")?.dataset.camera });
      }}
    >
      <div className={`toolbar${showToolbar ? " is-shown" : ""}`} role="toolbar" aria-label="Wall">
        {editing && (
          <>
            <span className="toolbar-note">Drag tiles to move them and pull their corners to resize them.</span>
            <label className="toolbar-note">
              <input type="checkbox" checked={lockRatio} onChange={(event) => setLockRatio(event.target.checked)} /> Lock to 16:9
            </label>
            {hidden.map((camera) => (
              <button key={camera} type="button" onClick={() => changeLayout(showCamera(layout ?? EMPTY_LAYOUT, camera))}>
                Show {cameraLabel(camera)}
              </button>
            ))}
            <button type="button" onClick={() => changeLayout(EMPTY_LAYOUT)}>
              Reset to Frigate order
            </button>
            <button type="button" className="primary" onClick={() => setEditing(false)}>
              Done
            </button>
          </>
        )}
        {!editing && url && cameras && cameras.length > 0 && (
          <button type="button" onClick={() => setEditing(true)}>
            Edit layout
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Settings"
          title={`Settings (${settingsKey})`}
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon />
        </button>
      </div>

      {settings && !url && (
        <section className="hero">
          <Logo />
          <h1>Ruru</h1>
          <p className="tagline">Eyes on every camera</p>
          <p className="note">Enter your Frigate address to see your cameras.</p>
          <button type="button" className="connect" onClick={() => setSettingsOpen(true)}>
            Connect to Frigate
          </button>
        </section>
      )}

      {url && discoveryError && (
        <p className="wall-error" role="alert">
          {discoveryError}
        </p>
      )}
      {url && cameras && cameras.length === 0 && <p className="wall-empty">Frigate has no cameras yet.</p>}
      {url && cameras && cameras.length > 0 && (
        <Wall
          base={url}
          cameras={cameras}
          layout={layout}
          live={live}
          editing={editing}
          lockRatio={lockRatio}
          refresh={refresh}
          onLayout={changeLayout}
        />
      )}

      {menu && <WallMenu x={menu.x} y={menu.y} items={[...streamItems, ...wallItems]} onClose={closeMenu} />}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onSaved={(saved) => {
            setSettings(saved);
            if (saved.frigateUrl !== url) {
              setCameras(null);
              setDiscoveryError(null);
            } else if (url) void discover(url);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {update && <UpdatePrompt update={update} onClose={() => setUpdate(null)} />}
      {!url && (
        <footer className="footer" aria-label="About Ruru">
          {info && (
            <span>
              {info.name} {info.version}
            </span>
          )}
        </footer>
      )}
    </main>
  );
}

export default App;
