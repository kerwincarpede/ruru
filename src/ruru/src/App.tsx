import "./App.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { appInfo, type AppInfo } from "./app/api";
import { cameraLabel, type Camera } from "./app/frigate";
import { isMac, shortcutFor } from "./app/keys";
import Logo from "./app/Logo";
import { DEFAULT_MQTT_SETTINGS, DEFAULT_WALL_OPTIONS, frigateCameras, getSettings, onFullScreenChanged, onOpenSettings, reportTileProblem, reportWallState, saveLayout, saveWallOptions, setFullScreen, type SavedLayout, type Settings, type WallOptions } from "./app/api";
import UpdatePrompt from "./app/UpdatePrompt";
import { findUpdate, versionLabel, type AvailableUpdate } from "./app/updates";
import SettingsDialog from "./settings/SettingsDialog";
import { EMPTY_LAYOUT, hideCamera, showCamera, wallPlacements } from "./wall/layout";
import { tileMenu, type MenuItem, type MenuSection } from "./wall/menu";
import type { StreamKind } from "./wall/streams";
import Wall from "./wall/Wall";
import WallMenu from "./wall/WallMenu";

/** How long the toolbar stays after the pointer stops moving. */
export const TOOLBAR_HIDE_MS = 2500;

const NO_SETTINGS: Settings = { frigateUrl: null, fullScreen: false, wall: DEFAULT_WALL_OPTIONS, updateChannel: "stable", mqtt: DEFAULT_MQTT_SETTINGS, layouts: {} };

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
  const [maximised, setMaximised] = useState<string | null>(null);
  const [reconnects, setReconnects] = useState<Record<string, number>>({});
  const [automatic, setAutomatic] = useState<Record<string, StreamKind>>({});
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
  // A channel switch in Settings meanwhile makes its answer stale.
  const channelSwitches = useRef(0);
  useEffect(() => {
    let current = true;
    const switches = channelSwitches.current;
    void findUpdate().then((found) => {
      if (current && switches === channelSwitches.current) setUpdate(found);
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

  // Lock to 16:9, Fit to window and stream info are saved as soon as they change.
  const wallOptions = settings?.wall ?? DEFAULT_WALL_OPTIONS;
  const changeWall = (change: Partial<WallOptions>) => {
    const next = { ...wallOptions, ...change };
    setSettings((current) => ({ ...(current ?? NO_SETTINGS), wall: next }));
    void saveWallOptions(next).catch(() => {});
  };

  // Home Assistant hears the wall's state and every tile's problems. The
  // backend only publishes them while Settings › Home Assistant is on.
  const fullScreenNow = settings?.fullScreen ?? false;
  const onWall = url && cameras ? wallPlacements(cameras.map((camera) => camera.name), layout).map((tile) => tile.camera) : null;
  const onWallKey = onWall ? JSON.stringify(onWall) : null;
  const shownMaximised = maximised && onWall?.includes(maximised) ? maximised : null;
  useEffect(() => {
    if (onWallKey === null) return;
    const report = { maximised: shownMaximised, fullScreen: fullScreenNow, windowShown: live, cameras: JSON.parse(onWallKey) as string[] };
    void reportWallState(report).catch(() => {});
  }, [onWallKey, shownMaximised, fullScreenNow, live]);
  const onProblem = useCallback((camera: string, problem: boolean) => {
    void reportTileProblem(camera, problem).catch(() => {});
  }, []);

  const onAutomatic = useCallback((camera: string, stream: StreamKind) => {
    setAutomatic((now) => (now[camera] === stream ? now : { ...now, [camera]: stream }));
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);
  const fullScreen = settings?.fullScreen ?? false;
  const wallItems: MenuItem[] = [
    { label: "Settings…", onSelect: () => setSettingsOpen(true) },
    ...(url && cameras?.length
      ? [
          { label: editing ? "Done editing" : "Edit layout", onSelect: () => setEditing((now) => !now) },
          { label: "Fit to window", kind: "checkbox" as const, checked: wallOptions.fitToWindow, onSelect: () => changeWall({ fitToWindow: !wallOptions.fitToWindow }) },
        ]
      : []),
    { label: fullScreen ? "Exit full screen" : "Enter full screen", onSelect: toggleFullScreen },
  ];
  const sections: MenuSection[] = [];
  const target = cameras?.find((camera) => camera.name === menu?.camera);
  if (target && cameras) {
    const tiles = wallPlacements(cameras.map((camera) => camera.name), layout);
    const name = target.name;
    sections.push(...tileMenu({
      label: cameraLabel(name),
      maximised: maximised === name,
      twoStreams: target.mainStream !== target.subStream,
      choice: tiles.find((tile) => tile.camera === name)?.stream,
      automatic: automatic[name] ?? "sub",
      streamInfo: wallOptions.streamInfo,
      onMaximise: () => setMaximised((now) => (now === name ? null : name)),
      onReconnect: () => setReconnects((now) => ({ ...now, [name]: (now[name] ?? 0) + 1 })),
      onHide: () => {
        setMaximised((now) => (now === name ? null : now));
        changeLayout(hideCamera({ tiles, hidden: layout?.hidden ?? [] }, name));
      },
      onStreamInfo: () => changeWall({ streamInfo: !wallOptions.streamInfo }),
      onStream: (stream) => changeLayout({
        hidden: layout?.hidden ?? [],
        tiles: tiles.map((tile) => tile.camera === name ? { ...tile, stream } : tile),
      }),
    }));
  }
  sections.push({ items: wallItems });
  const settingsKey = isMac() ? "⌘ ," : "Ctrl+,";
  const hidden = layout?.hidden ?? [];
  const showToolbar = toolbar || editing || !url;
  const version = info ? versionLabel(info, settings?.updateChannel ?? "stable") : null;

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
            {version && <span className="toolbar-note toolbar-version">{version}</span>}
            <span className="toolbar-note">Drag tiles to move them and pull their corners to resize them.</span>
            <label className="toolbar-note">
              <input type="checkbox" checked={wallOptions.lockRatio} onChange={(event) => changeWall({ lockRatio: event.target.checked })} /> Lock to 16:9
            </label>
            <label className="toolbar-note">
              <input type="checkbox" checked={wallOptions.fitToWindow} onChange={(event) => changeWall({ fitToWindow: event.target.checked })} /> Fit to window
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
          lockRatio={wallOptions.lockRatio}
          fitToWindow={wallOptions.fitToWindow}
          streamInfo={wallOptions.streamInfo}
          refresh={refresh}
          maximised={maximised}
          onMaximise={setMaximised}
          reconnects={reconnects}
          onAutomatic={onAutomatic}
          onProblem={onProblem}
          onLayout={changeLayout}
        />
      )}

      {menu && <WallMenu x={menu.x} y={menu.y} sections={sections} onClose={closeMenu} />}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          info={info}
          onChannelSaved={(saved) => {
            channelSwitches.current += 1;
            setSettings(saved);
          }}
          onMqttSaved={setSettings}
          onUpdate={setUpdate}
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
          {version && <span>{version}</span>}
        </footer>
      )}
    </main>
  );
}

export default App;
