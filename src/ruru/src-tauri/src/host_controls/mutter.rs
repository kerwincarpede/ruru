use std::process::Command;

const CONFIG: &str = "org.gnome.Mutter.DisplayConfig";
const PATH: &str = "/org/gnome/Mutter/DisplayConfig";
const POWER: &str = "PowerSaveMode";

fn bus(method: &str, value: &[&str]) -> Result<String, String> {
    let output = Command::new("/usr/bin/busctl")
        .args([
            "--user",
            "--timeout=2s",
            method,
            CONFIG,
            PATH,
            CONFIG,
            POWER,
        ])
        .args(value)
        .output()
        .map_err(|err| format!("Could not contact GNOME DisplayConfig: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "GNOME DisplayConfig: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn readback(value: &str) -> Result<bool, String> {
    match value.trim() {
        "i 0" => Ok(true),
        "i 1" | "i 2" | "i 3" => Ok(false),
        _ => Err("GNOME does not report a supported display power mode.".into()),
    }
}

pub(super) fn state() -> Result<bool, String> {
    readback(&bus("get-property", &[])?)
}

pub(super) fn set(on: bool) -> Result<(), String> {
    if state()? == on {
        return Ok(());
    }
    bus("set-property", &["i", if on { "0" } else { "3" }])?;
    if state()? == on {
        Ok(())
    } else {
        Err("GNOME did not confirm the requested display power mode.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interprets_mutter_modes_without_guessing_on_unsupported_hardware() {
        assert_eq!(readback("i 0\n"), Ok(true));
        for mode in ["i 1", "i 2", "i 3"] {
            assert_eq!(readback(mode), Ok(false));
        }
        assert!(readback("i -1").is_err());
        assert!(readback("").is_err());
    }
}
