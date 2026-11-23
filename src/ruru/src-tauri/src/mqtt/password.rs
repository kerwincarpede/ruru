//! The MQTT broker's password: in the system keychain when there is one,
//! otherwise in `settings.json`, and the settings say which.
//!
//! Keychains can be missing (a Raspberry Pi without a Secret Service) or
//! refuse (a locked login keychain), so every write is read back before it
//! counts. Calls can block on a keychain prompt: run them off the main thread.

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
    /// no password sent means the field was left alone; an empty one means
    /// the user cleared it.
    pub fn from_page(username: &str, password: Option<String>) -> Self {
        if username.trim().is_empty() {
            return Self::Remove;
        }
        match password {
            None => Self::Keep,
            Some(password) if password.is_empty() => Self::Remove,
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
            if mqtt.password_storage == PasswordStorage::Keychain
                && let Err(err) = store.delete(ACCOUNT)
            {
                eprintln!("Ruru: could not remove the MQTT password from the keychain: {err}");
            }
            mqtt.password = None;
            mqtt.password_storage = PasswordStorage::None;
        }
        PasswordChange::Set(password) => {
            let kept = store
                .set(ACCOUNT, &password)
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

/// The saved password, from wherever the settings say it is.
pub fn load(store: &dyn SecretStore, mqtt: &MqttSettings) -> Result<Option<String>, String> {
    match mqtt.password_storage {
        PasswordStorage::None => Ok(None),
        PasswordStorage::File => Ok(mqtt.password.clone()),
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
    /// accepts writes and keeps nothing.
    #[derive(Default)]
    pub struct FakeStore {
        pub secrets: RefCell<BTreeMap<String, String>>,
        pub broken: bool,
        pub forgetful: bool,
    }

    impl SecretStore for FakeStore {
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
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
            Ok(self.secrets.borrow().get(account).cloned())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.secrets.borrow_mut().remove(account);
            Ok(())
        }
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
            PasswordChange::Remove
        );
        // No username, no login.
        assert_eq!(
            PasswordChange::from_page(" ", Some("pw".into())),
            PasswordChange::Remove
        );
    }
}
