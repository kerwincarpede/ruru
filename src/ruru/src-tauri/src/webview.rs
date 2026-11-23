//! Webview switches the camera wall needs.
//!
//! WebKitGTK, Linux's webview, ships with WebRTC turned off, so Ruru turns
//! it on for its window. That only helps where WebKitGTK was built with
//! WebRTC: Ubuntu's and Debian's builds leave it out, and tiles there play
//! over MSE whatever this setting says. WebView2 and WKWebView have WebRTC on
//! already.

/// Turns on WebRTC (and the media stream API it builds on) in `window`'s
/// WebKitGTK webview.
#[cfg(target_os = "linux")]
pub fn enable_webrtc(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        if let Some(settings) = webview.inner().settings() {
            settings.set_enable_webrtc(true);
            settings.set_enable_media_stream(true);
        }
    })
}

/// WebRTC is already on outside Linux.
#[cfg(not(target_os = "linux"))]
pub fn enable_webrtc(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
