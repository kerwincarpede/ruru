//! The MQTT broker's password: in the system keychain when there is one,
//! otherwise in `settings.json`, and the settings say which.
//!
//! Keychains can be missing (a Raspberry Pi without a Secret Service) or
//! refuse, so every write is read back before it counts. A keychain that
//! would ask for its password counts as missing: Ruru often runs unattended
//! on a wall, where a prompt only covers the cameras. Calls can still block
//! on the keychain: run them off the main thread.

use crate::settings::{MqttSettings, PasswordStorage};

/// The keychain service Ruru's secrets are filed under, its bundle identifier.
const SERVICE: &str = "com.kerwincarpede.ruru";
/// The keychain account the broker password is filed under.
const ACCOUNT: &str = "mqtt";

/// Somewhere a secret can be kept by name. The system keychain in the app,
/// a fake in tests.
pub trait SecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    /// `None` when nothing is filed under `account`.
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    /// Removing what is not there succeeds.
    fn delete(&self, account: &str) -> Result<(), String>;
    /// Whether reaching `account` would make the store ask the user to
    /// unlock it. Asking must not show that prompt.
    fn locked(&self, account: &str) -> bool;
}

/// The system keychain: the macOS Keychain, Windows Credential Manager or
/// the Secret Service on Linux.
pub struct Keychain;

impl Keychain {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|err| err.to_string())
    }
}

impl SecretStore for Keychain {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|err| err.to_string())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }

    #[cfg(target_os = "linux")]
    fn locked(&self, account: &str) -> bool {
        secret_service::locked(SERVICE, account)
    }

    /// The macOS Keychain and Windows Credential Manager open with the
    /// user's session, so neither prompts at login.
    #[cfg(not(target_os = "linux"))]
    fn locked(&self, _account: &str) -> bool {
        false
    }
}

/// The Secret Service unlocks a locked keyring by showing a prompt, and the
/// keyring crate always asks it to. This asks first, without the prompt.
#[cfg(target_os = "linux")]
mod secret_service {
    use std::collections::HashMap;
    use zbus::{blocking::Connection, zvariant::OwnedObjectPath};

    const DESTINATION: &str = "org.freedesktop.secrets";
    const SERVICE_PATH: &str = "/org/freedesktop/secrets";
    const SERVICE: &str = "org.freedesktop.Secret.Service";
    const PROMPT: &str = "org.freedesktop.Secret.Prompt";
    /// The object path that means "none": no collection, or no prompt needed.
    const NONE: &str = "/";

    /// Whether the default keyring, or a locked item filed under `service`
    /// and `account`, would only open after a prompt. What opens without
    /// one, such as a keyring with an empty password, is unlocked. When the
    /// Secret Service can't be asked it counts as unlocked, so the keyring
    /// crate's own error is the one reported.
    pub fn locked(service: &str, account: &str) -> bool {
        needs_prompt(service, account).unwrap_or_else(|err| {
            eprintln!("Ruru: could not ask the Secret Service whether it is locked: {err}");
            false
        })
    }

    fn needs_prompt(service: &str, account: &str) -> zbus::Result<bool> {
        let bus = Connection::session()?;
        let mut paths: Vec<OwnedObjectPath> = Vec::new();
        let default: OwnedObjectPath = call(&bus, "ReadAlias", &("default",))?;
        if default.as_str() != NONE {
            paths.push(default);
        }
        let attributes = HashMap::from([("service", service), ("username", account)]);
        let (_, locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) =
            call(&bus, "SearchItems", &(attributes,))?;
        paths.extend(locked);
        if paths.is_empty() {
            return Ok(false);
        }
        let (_, prompt): (Vec<OwnedObjectPath>, OwnedObjectPath) = call(&bus, "Unlock", &(paths,))?;
        if prompt.as_str() == NONE {
            return Ok(false);
        }
        // A prompt is only shown once someone calls Prompt on it. Nobody
        // will, so let the Secret Service drop it.
        let _ = bus.call_method(
            Some(DESTINATION),
            prompt.as_str(),
            Some(PROMPT),
            "Dismiss",
            &(),
        );
        Ok(true)
    }

    fn call<B, R>(bus: &Connection, method: &str, body: &B) -> zbus::Result<R>
    where
        B: serde::Serialize + zbus::zvariant::DynamicType,
        R: for<'d> zbus::zvariant::DynamicDeserialize<'d>,
    {
        bus.call_method(Some(DESTINATION), SERVICE_PATH, Some(SERVICE), method, body)?
            .body()
            .deserialize()
    }
}

/// What a save does to the password.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasswordChange {
    /// Leave the saved one as it is.
    Keep,
    /// Forget it, wherever it is.
    Remove,
    /// Replace it.
    Set(String),
}

impl PasswordChange {
    /// What the page asked for. No username means no login, so no password;
    /// no password, or an empty one, keeps the saved one, so clearing the
    /// field never deletes it by accident.
    pub fn from_page(username: &str, password: Option<String>) -> Self {
        if username.trim().is_empty() {
            return Self::Remove;
        }
        match password {
            None => Self::Keep,
            Some(password) if password.is_empty() => Self::Keep,
            Some(password) => Self::Set(password),
        }
    }
}

/// Applies `change` to `mqtt`: a new password goes in the keychain when it
/// reads back the same, and otherwise in the settings file. A password moved
/// out of the file is cleared from it.
pub fn apply(
    store: &dyn SecretStore,
    mut mqtt: MqttSettings,
    change: PasswordChange,
) -> MqttSettings {
    match change {
        PasswordChange::Keep => {}
        PasswordChange::Remove => {
            if mqtt.password_storage == PasswordStorage::Keychain {
                if store.locked(ACCOUNT) {
                    eprintln!("Ruru: the keychain is locked, so the old MQTT password stays in it");
                } else if let Err(err) = store.delete(ACCOUNT) {
                    eprintln!("Ruru: could not remove the MQTT password from the keychain: {err}");
                }
            }
            mqtt.password = None;
            mqtt.password_storage = PasswordStorage::None;
        }
        PasswordChange::Set(password) => {
            let kept = if store.locked(ACCOUNT) {
                Err("the keychain is locked".into())
            } else {
                Ok(())
            };
            let kept = kept
                .and_then(|()| store.set(ACCOUNT, &password))
                .and_then(|()| store.get(ACCOUNT))
                .and_then(|read| match read {
                    Some(read) if read == password => Ok(()),
                    _ => Err("the keychain did not keep it".into()),
                });
            match kept {
                Ok(()) => {
                    mqtt.password = None;
                    mqtt.password_storage = PasswordStorage::Keychain;
                }
                Err(err) => {
                    eprintln!(
                        "Ruru: keeping the MQTT password in settings.json, the keychain could not take it: {err}"
                    );
                    mqtt.password = Some(password);
                    mqtt.password_storage = PasswordStorage::File;
                }
            }
        }
    }
    mqtt
}

/// Why the saved password can't be used while the keychain is locked, and
/// what to do about it.
const LOCKED: &str = "The keychain is locked, so Ruru can't read the MQTT password. \
Unlock it, or enter the password again in Settings → Home Assistant to keep it in settings.json.";

/// The saved password, from wherever the settings say it is. A locked
/// keychain is an error, never a prompt.
pub fn load(store: &dyn SecretStore, mqtt: &MqttSettings) -> Result<Option<String>, String> {
    match mqtt.password_storage {
        PasswordStorage::None => Ok(None),
        PasswordStorage::File => Ok(mqtt.password.clone()),
        PasswordStorage::Keychain if store.locked(ACCOUNT) => Err(LOCKED.into()),
        PasswordStorage::Keychain => store
            .get(ACCOUNT)
            .map_err(|err| format!("The MQTT password could not be read from the keychain: {err}")),
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::{cell::RefCell, collections::BTreeMap};

    /// A keychain in memory. `broken` refuses every write; `forgetful`
    /// accepts writes and keeps nothing; `locked` would prompt, so any read
    /// or write while it is set fails the test.
    #[derive(Default)]
    pub struct FakeStore {
        pub secrets: RefCell<BTreeMap<String, String>>,
        pub broken: bool,
        pub forgetful: bool,
        pub locked: bool,
    }

    impl FakeStore {
        fn unprompted(&self) {
            assert!(!self.locked, "the locked keychain was asked to prompt");
        }
    }

    impl SecretStore for FakeStore {
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.unprompted();
            if self.broken {
                return Err("no keychain".into());
            }
            if !self.forgetful {
                self.secrets
                    .borrow_mut()
                    .insert(account.into(), secret.into());
            }
            Ok(())
        }

        fn get(&self, account: &str) -> Result<Option<String>, String> {
            self.unprompted();
            Ok(self.secrets.borrow().get(account).cloned())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.unprompted();
            self.secrets.borrow_mut().remove(account);
            Ok(())
        }

        fn locked(&self, _account: &str) -> bool {
            self.locked
        }
    }

    #[test]
    fn a_locked_keychain_leaves_the_password_in_the_file() {
        let store = FakeStore {
            locked: true,
            ..FakeStore::default()
        };
        let mqtt = apply(
            &store,
            MqttSettings::default(),
            PasswordChange::Set("secret".into()),
        );
        assert_eq!(mqtt.password_storage, PasswordStorage::File);
        assert_eq!(mqtt.password.as_deref(), Some("secret"));
        assert_eq!(load(&store, &mqtt).unwrap().as_deref(), Some("secret"));
    }

    #[test]
    fn a_password_in_a_locked_keychain_is_not_prompted_for() {
        let mut store = FakeStore::default();
        let mqtt = apply(
            &store,
            MqttSettings::default(),
            PasswordChange::Set("secret".into()),
        );
        store.locked = true;
        assert_eq!(load(&store, &mqtt).unwrap_err(), LOCKED);
        // Entering it again moves it to the file.
        let mqtt = apply(&store, mqtt, PasswordChange::Set("again".into()));
        assert_eq!(mqtt.password_storage, PasswordStorage::File);
        assert_eq!(load(&store, &mqtt).unwrap().as_deref(), Some("again"));
    }

    #[test]
    fn removing_a_password_from_a_locked_keychain_forgets_it_without_a_prompt() {
        let mut store = FakeStore::default();
        let mqtt = apply(
            &store,
            MqttSettings::default(),
            PasswordChange::Set("secret".into()),
        );
        store.locked = true;
        let mqtt = apply(&store, mqtt, PasswordChange::Remove);
        assert_eq!(mqtt.password_storage, PasswordStorage::None);
        assert_eq!(load(&store, &mqtt).unwrap(), None);
    }

    #[test]
    fn a_password_goes_in_the_keychain_and_out_of_the_file() {
        let store = FakeStore::default();
        let before = MqttSettings {
            password: Some("old".into()),
            password_storage: PasswordStorage::File,
            ..MqttSettings::default()
        };
        let mqtt = apply(&store, before, PasswordChange::Set("secret".into()));
        assert_eq!(mqtt.password_storage, PasswordStorage::Keychain);
        assert_eq!(mqtt.password, None);
        assert_eq!(store.secrets.borrow()[ACCOUNT], "secret");
        assert_eq!(load(&store, &mqtt).unwrap().as_deref(), Some("secret"));
    }

    #[test]
    fn without_a_keychain_the_password_stays_in_the_file() {
        for store in [
            FakeStore {
                broken: true,
                ..FakeStore::default()
            },
            FakeStore {
                forgetful: true,
                ..FakeStore::default()
            },
        ] {
            let mqtt = apply(
                &store,
                MqttSettings::default(),
                PasswordChange::Set("secret".into()),
            );
            assert_eq!(mqtt.password_storage, PasswordStorage::File);
            assert_eq!(mqtt.password.as_deref(), Some("secret"));
            assert_eq!(load(&store, &mqtt).unwrap().as_deref(), Some("secret"));
        }
    }

    #[test]
    fn removing_the_password_clears_the_keychain_and_the_file() {
        let store = FakeStore::default();
        let mqtt = apply(
            &store,
            MqttSettings::default(),
            PasswordChange::Set("secret".into()),
        );
        let mqtt = apply(&store, mqtt, PasswordChange::Remove);
        assert_eq!(mqtt.password_storage, PasswordStorage::None);
        assert_eq!(mqtt.password, None);
        assert!(store.secrets.borrow().is_empty());
        assert_eq!(load(&store, &mqtt).unwrap(), None);
    }

    #[test]
    fn keeping_the_password_changes_nothing() {
        let store = FakeStore::default();
        let mqtt = apply(
            &store,
            MqttSettings::default(),
            PasswordChange::Set("secret".into()),
        );
        assert_eq!(apply(&store, mqtt.clone(), PasswordChange::Keep), mqtt);
        assert_eq!(store.secrets.borrow()[ACCOUNT], "secret");
    }

    #[test]
    fn the_page_keeps_sets_or_clears_the_password() {
        assert_eq!(
            PasswordChange::from_page("ruru", None),
            PasswordChange::Keep
        );
        assert_eq!(
            PasswordChange::from_page("ruru", Some("pw".into())),
            PasswordChange::Set("pw".into())
        );
        assert_eq!(
            PasswordChange::from_page("ruru", Some(String::new())),
            PasswordChange::Keep
        );
        // No username, no login.
        assert_eq!(
            PasswordChange::from_page(" ", Some("pw".into())),
            PasswordChange::Remove
        );
    }
}
