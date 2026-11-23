//! Optional controls for a Ruru installation managed by Ubuntu's user systemd.

#[cfg(target_os = "linux")]
mod agent;
#[cfg(target_os = "linux")]
mod mutter;
#[cfg(target_os = "linux")]
mod samples;
#[cfg(target_os = "linux")]
mod setup;
#[cfg(target_os = "linux")]
mod system;

/// Handles the Linux package's agent and managed launcher entry points.
#[cfg(target_os = "linux")]
pub fn dispatch() -> Option<Result<(), String>> {
    match std::env::args().nth(1).as_deref() {
        Some("--host-agent") => Some(agent::run()),
        Some("--host-activate") => Some(setup::activate()),
        Some("--managed-wall") => None,
        _ if setup::installed() && setup::enabled() => Some(system::open_wall()),
        _ => None,
    }
}

/// Whether the independent agent owns Display discovery and commands.
pub fn enabled() -> bool {
    #[cfg(target_os = "linux")]
    {
        setup::installed() && setup::enabled()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Confirms successful app setup to the systemd unit waiting for readiness.
pub fn app_ready() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if std::env::args().nth(1).as_deref() == Some("--managed-wall") {
        return system::notify_ready();
    }
    Ok(())
}

/// Mirrors `HostControlsCredentials` in src/app/api.ts.
#[derive(serde::Deserialize)]
pub struct HostControlsCredentials {
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    username: String,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    password: String,
}

/// Mirrors `HostControlsStatus` in src/app/api.ts.
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostControlsStatus {
    supported: bool,
    enabled: bool,
    connected: bool,
    cleanup_pending: bool,
    message: Option<String>,
}

/// Reports host control availability and the independent agent's status.
#[tauri::command]
pub async fn host_controls_status() -> Result<HostControlsStatus, String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(setup::status)
            .await
            .map_err(|err| err.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(HostControlsStatus::default())
    }
}

/// Tests the independent agent credentials against the saved broker.
#[tauri::command]
pub async fn test_host_controls(
    store: tauri::State<'_, crate::settings::SharedSettings>,
    credentials: HostControlsCredentials,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let saved = crate::settings::lock(&store).current().mqtt.clone();
        setup::test(saved, credentials).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (store, credentials);
        Err("Host controls are available on Ubuntu.".into())
    }
}

/// Migrates the wall to the service and enables the agent after local consent.
#[tauri::command]
pub async fn enable_host_controls(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::settings::SharedSettings>,
    credentials: HostControlsCredentials,
    consent: bool,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _guard = setup::CHANGE.lock().await;
        let saved = crate::settings::lock(&store).current().mqtt.clone();
        setup::enable(saved, credentials, consent).await?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, store, credentials, consent);
        Err("Host controls are available on Ubuntu.".into())
    }
}

/// Disables the agent, restores startup settings and clears retained entities.
#[tauri::command]
pub async fn disable_host_controls(app: tauri::AppHandle) -> Result<HostControlsStatus, String> {
    #[cfg(target_os = "linux")]
    {
        let _guard = setup::CHANGE.lock().await;
        let message = setup::disable().await?;
        crate::mqtt::restart(&app);
        let mut status = host_controls_status().await?;
        status.message = message;
        Ok(status)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Host controls are available on Ubuntu.".into())
    }
}

#[cfg(target_os = "linux")]
pub(crate) use setup::{CHANGE, check_wall_broker};

/// Restarts the wall through its user service when an update was installed there.
pub fn restart_after_update(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if std::env::args().nth(1).as_deref() == Some("--managed-wall") {
        if setup::enabled() {
            system::ctl(&["--no-block", "restart", system::WALL, system::AGENT])?;
        } else {
            setup::schedule_takeover()?;
            app.exit(0);
        }
        return Ok(());
    }
    app.restart()
}
