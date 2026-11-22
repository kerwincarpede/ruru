import "./App.css";
import { useEffect, useState } from "react";
import { appInfo, type AppInfo } from "./app/api";
import Logo from "./app/Logo";

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let live = true;
    appInfo()
      .then((next) => {
        if (live) setInfo(next);
      })
      // Without the backend's answer the footer stays empty; nothing else depends on it.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="window placeholder">
      <section className="hero">
        <Logo />
        <h1>Ruru</h1>
        <p className="tagline">Eyes on every camera</p>
        <p className="note">Connecting to your Frigate server is coming soon.</p>
      </section>
      <footer className="footer" aria-label="About Ruru">
        {info && (
          <span>
            {info.name} {info.version}
          </span>
        )}
      </footer>
    </main>
  );
}

export default App;
