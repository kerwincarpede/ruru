// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if let Some(result) = ruru_lib::host_controls::dispatch() {
        if let Err(error) = result {
            eprintln!("Ruru: {error}");
            std::process::exit(1);
        }
        return;
    }
    ruru_lib::run()
}
