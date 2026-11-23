//! Connecting to the broker: the options every connection uses, how long to
//! wait between attempts, the TLS setup, and the one-off check behind
//! Test connection.

use std::{sync::Arc, time::Duration};

use rumqttc::{
    AsyncClient, ConnectReturnCode, ConnectionError, Event, LastWill, MqttOptions, Packet,
    TlsConfiguration, Transport,
    tokio_rustls::rustls::{ClientConfig, RootCertStore},
};

use super::MqttError;

/// How long Test connection waits for the broker to accept it.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How often Ruru tells the broker it is still there. The broker publishes
/// the last will after one and a half of these without a word.
const KEEP_ALIVE: Duration = Duration::from_secs(30);
/// The first wait before connecting again, doubled after each failure.
const FIRST_BACKOFF: Duration = Duration::from_secs(1);
/// The longest wait between attempts.
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// Messages that can queue for the broker: every camera's discovery and
/// problem, with room to spare.
pub const QUEUE: usize = 4 * crate::settings::MAX_TILES + 64;

/// Where and how to connect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Broker {
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub username: String,
    pub password: Option<String>,
}

impl Broker {
    /// `host:port`, for messages.
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

/// How long to wait before connection attempt `attempt` (from 0) after a
/// failure: one second, doubling to a minute.
pub fn backoff(attempt: u32) -> Duration {
    FIRST_BACKOFF
        .checked_mul(2u32.saturating_pow(attempt))
        .unwrap_or(MAX_BACKOFF)
        .min(MAX_BACKOFF)
}

/// Rustls trusting the system's root certificates, with the ring provider
/// that `frigate.rs` also installs.
fn tls() -> Result<TlsConfiguration, MqttError> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Another thread may install it first; either provider is the same.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let mut roots = RootCertStore::empty();
    let (added, _) =
        roots.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
    if added == 0 {
        return Err(MqttError::Tls(
            "This computer has no trusted root certificates.".into(),
        ));
    }
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(TlsConfiguration::Rustls(Arc::new(config)))
}

/// The options for connecting to `broker` as `client_id`, with `will`
/// published by the broker if the connection drops.
pub fn options(
    broker: &Broker,
    client_id: &str,
    will: Option<LastWill>,
) -> Result<MqttOptions, MqttError> {
    let mut options = MqttOptions::new(client_id, broker.host.clone(), broker.port);
    options
        .set_keep_alive(KEEP_ALIVE)
        .set_request_channel_capacity(QUEUE);
    if !broker.username.is_empty() {
        options.set_credentials(
            broker.username.clone(),
            broker.password.clone().unwrap_or_default(),
        );
    }
    if let Some(will) = will {
        options.set_last_will(will);
    }
    if broker.tls {
        options.set_transport(Transport::tls_with_config(tls()?));
    }
    Ok(options)
}

/// A failed connection, as the user reads it.
pub fn describe(broker: &Broker, err: &ConnectionError) -> MqttError {
    let address = broker.address();
    match err {
        ConnectionError::ConnectionRefused(
            ConnectReturnCode::BadUserNamePassword | ConnectReturnCode::NotAuthorized,
        ) => MqttError::Refused(format!(
            "The broker at {address} refused the username or password."
        )),
        ConnectionError::ConnectionRefused(code) => MqttError::Refused(format!(
            "The broker at {address} refused the connection ({code:?})."
        )),
        ConnectionError::NetworkTimeout => MqttError::Timeout(address),
        ConnectionError::Tls(err) => {
            MqttError::Tls(format!("TLS to the broker at {address} failed: {err}"))
        }
        other => MqttError::Unreachable {
            address,
            message: other.to_string(),
        },
    }
}

/// Connects to `broker` once and disconnects, for Test connection.
pub async fn test(broker: &Broker) -> Result<(), MqttError> {
    let id = format!("ruru-test-{}", crate::settings::new_device_id());
    let (client, mut events) = AsyncClient::new(options(broker, &id, None)?, 10);
    let connect = async {
        loop {
            match events.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(_))) => return Ok(()),
                Ok(_) => {}
                Err(err) => return Err(describe(broker, &err)),
            }
        }
    };
    tokio::time::timeout(CONNECT_TIMEOUT, connect)
        .await
        .map_err(|_| MqttError::Timeout(broker.address()))??;
    // Say goodbye so the broker does not log a dropped client.
    if client.try_disconnect().is_ok() {
        let _ = tokio::time::timeout(Duration::from_secs(1), events.poll()).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn broker() -> Broker {
        Broker {
            host: "ha.local".into(),
            port: 1883,
            tls: false,
            username: String::new(),
            password: None,
        }
    }

    #[test]
    fn backoff_doubles_from_a_second_to_a_minute() {
        let waits: Vec<u64> = (0..9).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(waits, [1, 2, 4, 8, 16, 32, 60, 60, 60]);
        assert_eq!(backoff(u32::MAX), MAX_BACKOFF);
    }

    #[test]
    fn options_carry_the_login_and_the_last_will() {
        let mut login = broker();
        login.username = "ruru".into();
        login.password = Some("secret".into());
        let will = LastWill::new(
            "ruru/x/availability",
            "offline",
            rumqttc::QoS::AtLeastOnce,
            true,
        );
        let options = options(&login, "ruru-x", Some(will.clone())).unwrap();
        assert_eq!(options.broker_address(), ("ha.local".to_string(), 1883));
        assert_eq!(options.client_id(), "ruru-x");
        let credentials = options.credentials().unwrap();
        assert_eq!(credentials.username, "ruru");
        assert_eq!(credentials.password, "secret");
        assert_eq!(options.last_will(), Some(will));
        assert_eq!(options.keep_alive(), KEEP_ALIVE);
    }

    #[test]
    fn a_broker_without_a_username_gets_no_login() {
        let mut open = broker();
        open.password = Some("ignored".into());
        assert!(
            options(&open, "ruru-x", None)
                .unwrap()
                .credentials()
                .is_none()
        );
    }

    #[test]
    fn addresses_bracket_ipv6_hosts() {
        assert_eq!(broker().address(), "ha.local:1883");
        let mut v6 = broker();
        v6.host = "fd00::1".into();
        assert_eq!(v6.address(), "[fd00::1]:1883");
    }

    #[test]
    fn failures_read_as_what_went_wrong() {
        let broker = broker();
        let refused = describe(
            &broker,
            &ConnectionError::ConnectionRefused(ConnectReturnCode::NotAuthorized),
        );
        assert_eq!(
            refused.to_string(),
            "The broker at ha.local:1883 refused the username or password."
        );
        assert_eq!(
            describe(&broker, &ConnectionError::NetworkTimeout).to_string(),
            "The broker at ha.local:1883 did not answer."
        );
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        assert_eq!(
            describe(&broker, &ConnectionError::Io(io)).to_string(),
            "Could not reach the broker at ha.local:1883: I/O: refused"
        );
    }
}
