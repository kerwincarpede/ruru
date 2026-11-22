import "./App.css";
import { useEffect, useState } from "react";
import { appInfo, type AppInfo } from "./app/api";
import Logo from "./app/Logo";
import UpdatePrompt from "./app/UpdatePrompt";
import { findUpdate, type AvailableUpdate } from "./app/updates";

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

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

  return (
    <main className="window placeholder">
      <section className="hero">
        <Logo />
        <h1>Ruru</h1>
        <p className="tagline">Eyes on every camera</p>
        <p className="note">Connecting to your Frigate server is coming soon.</p>
      </section>
      {update && <UpdatePrompt update={update} onClose={() => setUpdate(null)} />}
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
