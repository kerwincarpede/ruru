use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};

use rumqttc::v5::{
    AsyncClient, Event, EventLoop, MqttOptions,
    mqttbytes::{
        QoS,
        v5::{
            Filter, LastWill, Packet, PubAckReason, Publish, RetainForwardRule, SubscribeReasonCode,
        },
    },
};
use serde_json::{Value, json};
use tauri::async_runtime::{self, JoinHandle};

use super::{setup, system};
use crate::mqtt::{
    client::{self, Broker},
    discovery::{self, Device, Message, on_off},
    topics::Topics,
};

const QOS: QoS = QoS::AtLeastOnce;

struct Wire<'a> {
    topics: &'a Topics,
    device: &'a Device,
}

impl Wire<'_> {
    fn topic(&self, suffix: &str) -> String {
        self.topics.own(&format!("agent/{suffix}"))
    }

    fn message(&self, suffix: &str, payload: impl Into<String>) -> Message {
        Message::retained(self.topic(suffix), payload)
    }

    fn command(&self, publish: &Publish) -> Option<Action> {
        if publish.retain || publish.dup {
            return None;
        }
        let on = match publish.payload.as_ref() {
            b"ON" => true,
            b"OFF" => false,
            _ => return None,
        };
        if publish.topic.as_ref() == self.topic("command/ruru").as_bytes() {
            Some(Action::Wall(on))
        } else if publish.topic.as_ref() == self.topic("command/display").as_bytes() {
            Some(Action::Display(on))
        } else {
            None
        }
    }

    fn filter(&self, suffix: &str) -> Filter {
        Filter {
            preserve_retain: true,
            retain_forward_rule: RetainForwardRule::Never,
            ..Filter::new(self.topic(suffix), QOS)
        }
    }

    fn filters(&self) -> Vec<Filter> {
        vec![
            self.filter("command/ruru"),
            self.filter("command/display"),
            Filter::new(self.topics.home_assistant_status(), QOS),
        ]
    }

    fn availability(&self, local: &str) -> Value {
        json!([
            { "topic": self.topic("availability") },
            { "topic": self.topic(local) }
        ])
    }

    fn switches(&self) -> Vec<Message> {
        [("ruru", "Ruru"), ("display", "Display")]
            .into_iter()
            .map(|(object, name)| {
                let mut config = discovery::base(self.topics, self.device, object, name);
                config.remove("availability_topic");
                config.insert(
                    "availability".into(),
                    self.availability(&format!("{object}/availability")),
                );
                config.insert("availability_mode".into(), "all".into());
                config.insert(
                    "state_topic".into(),
                    self.topic(&format!("{object}/state")).into(),
                );
                config.insert(
                    "command_topic".into(),
                    self.topic(&format!("command/{object}")).into(),
                );
                config.insert(
                    "json_attributes_topic".into(),
                    self.topic(&format!("{object}/attributes")).into(),
                );
                config.insert("retain".into(), false.into());
                config.insert("qos".into(), 1.into());
                Message::retained(
                    self.topics.discovery("switch", object),
                    Value::Object(config).to_string(),
                )
            })
            .collect()
    }

    fn sensors(&self) -> Vec<Message> {
        [("cpu", "Ruru CPU", "%"), ("memory", "Ruru memory", "MiB")]
            .into_iter()
            .map(|(object, name, unit)| {
                let mut config = discovery::base(self.topics, self.device, object, name);
                config.remove("availability_topic");
                config.insert(
                    "availability".into(),
                    self.availability(&format!("{object}/availability")),
                );
                config.insert("availability_mode".into(), "all".into());
                config.insert(
                    "state_topic".into(),
                    self.topic(&format!("{object}/state")).into(),
                );
                config.insert("unit_of_measurement".into(), unit.into());
                config.insert("state_class".into(), "measurement".into());
                if object == "memory" {
                    config.insert("device_class".into(), "data_size".into());
                }
                Message::retained(
                    self.topics.discovery("sensor", object),
                    Value::Object(config).to_string(),
                )
            })
            .collect()
    }

    fn discovery(&self) -> Vec<Message> {
        self.switches().into_iter().chain(self.sensors()).collect()
    }

    fn cleanup(&self) -> Vec<Message> {
        let mut messages = self.discovery();
        for message in &mut messages {
            message.payload.clear();
        }
        messages.push(self.message("availability", ""));
        for object in ["display", "ruru", "cpu", "memory"] {
            for suffix in ["state", "availability", "attributes"] {
                messages.push(self.message(&format!("{object}/{suffix}"), ""));
            }
        }
        messages
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Wall(bool),
    Display(bool),
}

fn connection(
    broker: &Broker,
    id: String,
    will: Option<LastWill>,
) -> Result<(AsyncClient, EventLoop), String> {
    let common = client::options(broker, &id, None).map_err(|err| err.to_string())?;
    let mut options = MqttOptions::new(id, broker.host.clone(), broker.port);
    options
        .set_transport(common.transport())
        .set_clean_start(true)
        .set_keep_alive(common.keep_alive())
        .set_max_packet_size(Some(16 * 1024));
    if !broker.username.is_empty() {
        options.set_credentials(
            broker.username.clone(),
            broker.password.clone().unwrap_or_default(),
        );
    }
    if let Some(will) = will {
        options.set_last_will(will);
    }
    Ok(AsyncClient::new(options, 64))
}

fn send(client: &AsyncClient, messages: Vec<Message>) -> Result<(), String> {
    for message in messages {
        client
            .try_publish(message.topic, QOS, message.retain, message.payload)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

async fn bounded<T>(work: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(client::CONNECT_TIMEOUT, work)
        .await
        .map_err(|_| "The host controls broker did not answer in time.".to_owned())?
}

async fn subscribed(events: &mut EventLoop, mut observe: impl FnMut(Event)) -> Result<(), String> {
    loop {
        let event = incoming(events).await?;
        if let Event::Incoming(Packet::SubAck(ack)) = event {
            return if ack
                .return_codes
                .iter()
                .all(|code| matches!(code, SubscribeReasonCode::Success(_)))
            {
                Ok(())
            } else {
                Err("The broker refused the host controls subscriptions.".into())
            };
        }
        observe(event);
    }
}

async fn incoming(events: &mut EventLoop) -> Result<Event, String> {
    let event = events.poll().await.map_err(|err| err.to_string())?;
    if let Event::Incoming(Packet::PubAck(ack)) = &event
        && !matches!(
            ack.reason,
            PubAckReason::Success | PubAckReason::NoMatchingSubscribers
        )
    {
        return Err(format!(
            "The broker refused a host controls message ({:?}).",
            ack.reason
        ));
    }
    Ok(event)
}

fn device() -> Device {
    let version = serde_json::from_str::<Value>(include_str!("../../tauri.conf.json"))
        .ok()
        .and_then(|config| config["version"].as_str().map(str::to_owned))
        .unwrap_or_default();
    Device::this_install(version)
}

pub(super) async fn test(config: &setup::Config) -> Result<(), String> {
    let topics = Topics::new(&config.device_id, &config.discovery_prefix);
    let device = device();
    let wire = Wire {
        topics: &topics,
        device: &device,
    };
    let (client, mut events) = connection(
        &config.broker(),
        format!("ruru-host-test-{}", crate::settings::new_device_id()),
        None,
    )?;
    client
        .try_subscribe_many(wire.filters())
        .map_err(|err| err.to_string())?;
    bounded(subscribed(&mut events, |_| {})).await?;
    disconnect(&client, &mut events).await;
    Ok(())
}

pub(super) async fn cleanup(config: &setup::Config) -> Result<(), String> {
    let topics = Topics::new(&config.device_id, &config.discovery_prefix);
    let device = device();
    let wire = Wire {
        topics: &topics,
        device: &device,
    };
    let (client, mut events) = connection(
        &config.broker(),
        format!("ruru-host-cleanup-{}", crate::settings::new_device_id()),
        None,
    )?;
    let cleanup = wire.cleanup();
    let expected = cleanup.len();
    send(&client, cleanup)?;
    acknowledged(&mut events, expected, |_| {}).await?;
    disconnect(&client, &mut events).await;
    Ok(())
}

async fn acknowledged(
    events: &mut EventLoop,
    expected: usize,
    mut observe: impl FnMut(Event),
) -> Result<(), String> {
    bounded(async {
        let mut count = 0;
        while count < expected {
            acknowledge_event(incoming(events).await?, &mut count, &mut observe);
        }
        Ok(())
    })
    .await
}

fn acknowledge_event(event: Event, count: &mut usize, observe: &mut impl FnMut(Event)) {
    if matches!(event, Event::Incoming(Packet::PubAck(_))) {
        *count += 1;
    } else {
        observe(event);
    }
}

async fn disconnect(client: &AsyncClient, events: &mut EventLoop) {
    if client.try_disconnect().is_ok() {
        let _ = tokio::time::timeout(Duration::from_secs(1), async {
            while let Ok(event) = events.poll().await {
                if matches!(event, Event::Outgoing(rumqttc::Outgoing::Disconnect)) {
                    break;
                }
            }
        })
        .await;
    }
}

pub(super) fn run() -> Result<(), String> {
    setup::write_status(false, None);
    let config = setup::read_config()?;
    async_runtime::block_on(async {
        let topics = Topics::new(&config.device_id, &config.discovery_prefix);
        let device = device();
        let wire = Wire {
            topics: &topics,
            device: &device,
        };
        let broker = config.broker();
        let mut attempt = 0;
        let mut state = State::default();
        while setup::enabled() {
            let error = session(&broker, &wire, &mut attempt, &mut state).await;
            setup::write_status(false, error.as_ref().err().map(String::as_str));
            if let Err(error) = error {
                eprintln!("Ruru host controls: {error}");
            }
            tokio::time::sleep(client::backoff(attempt)).await;
            attempt = attempt.saturating_add(1);
        }
        Ok(())
    })
}

async fn session(
    broker: &Broker,
    wire: &Wire<'_>,
    attempt: &mut u32,
    state: &mut State,
) -> Result<(), String> {
    let will = LastWill::new(wire.topic("availability"), "offline", QOS, true, None);
    let (client, mut events) = connection(
        broker,
        format!("ruru-{}-host", wire.topics.device_id()),
        Some(will),
    )?;
    client
        .try_subscribe_many(wire.filters())
        .map_err(|err| err.to_string())?;
    // Drop waiting commands and republish state for a new clean session.
    state.reconnect();
    bounded(subscribed(&mut events, |event| {
        state.enqueue_event(wire, event)
    }))
    .await?;
    let configs = wire.discovery();
    let config_count = configs.len();
    send(&client, configs)?;
    let state_count = state.report(wire, &client).await?;
    send(&client, vec![wire.message("availability", "online")])?;
    acknowledged(&mut events, config_count + state_count + 1, |event| {
        state.enqueue_event(wire, event);
    })
    .await?;
    state.start_next(wire, &client)?;
    setup::write_status(true, state.error());
    *attempt = 0;
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        // Keep the current MQTT poll alive across ticks. Dropping it during
        // a socket write could leave a partial packet on the connection.
        let next = incoming(&mut events);
        tokio::pin!(next);
        let event = loop {
            tokio::select! {
                event = &mut next => break event?,
                _ = ticker.tick() => {
                    state.report(wire, &client).await?;
                    state.start_next(wire, &client)?;
                    setup::write_status(true, state.error());
                }
            }
        };
        if let Event::Incoming(Packet::Publish(publish)) = event {
            if publish.topic.as_ref() == wire.topics.home_assistant_status().as_bytes()
                && publish.payload.as_ref() == b"online"
            {
                send(&client, wire.discovery())?;
                send(&client, vec![wire.message("availability", "online")])?;
                state.published.clear();
                state.report(wire, &client).await?;
            } else if let Some(action) = wire.command(&publish) {
                state.enqueue(action);
                state.start_next(wire, &client)?;
            }
        }
    }
}

#[derive(Default)]
struct State {
    pending: Option<(Action, JoinHandle<Result<(), String>>)>,
    queued: VecDeque<Action>,
    published: BTreeMap<String, String>,
    wall_error: Diagnostics,
    display_error: Diagnostics,
    cpu: super::samples::Cpu,
}

#[derive(Default)]
struct Diagnostics {
    read: Option<String>,
    command: Option<(bool, String)>,
}

impl Diagnostics {
    fn message(&self) -> Option<&str> {
        self.read
            .as_deref()
            .or_else(|| self.command.as_ref().map(|(_, error)| error.as_str()))
    }

    fn observed(&mut self, on: Option<bool>, error: Option<String>) {
        self.read = error;
        if self
            .command
            .as_ref()
            .is_some_and(|(wanted, _)| on == Some(*wanted))
        {
            self.command = None;
        }
    }
}

impl State {
    fn error(&self) -> Option<&str> {
        self.wall_error.message().or(self.display_error.message())
    }

    fn reconnect(&mut self) {
        self.queued.clear();
        self.published.clear();
    }

    fn enqueue_event(&mut self, wire: &Wire<'_>, event: Event) {
        if let Event::Incoming(Packet::Publish(publish)) = event
            && let Some(action) = wire.command(&publish)
        {
            self.enqueue(action);
        }
    }

    fn enqueue(&mut self, action: Action) {
        if self.queued.len() < 8 {
            self.queued.push_back(action);
        }
    }

    fn start_next(&mut self, wire: &Wire<'_>, client: &AsyncClient) -> Result<(), String> {
        self.start_next_with(wire, client, |action| {
            async_runtime::spawn_blocking(move || {
                let result = match action {
                    Action::Wall(on) => system::change_wall(on),
                    Action::Display(on) => super::mutter::set(on),
                };
                if let Err(err) = &result {
                    eprintln!("Ruru host controls: {err}");
                }
                result
            })
        })
    }

    fn start_next_with(
        &mut self,
        wire: &Wire<'_>,
        client: &AsyncClient,
        spawn: impl FnOnce(Action) -> JoinHandle<Result<(), String>>,
    ) -> Result<(), String> {
        if self.pending.is_some() {
            return Ok(());
        }
        let Some(action) = self.queued.pop_front() else {
            return Ok(());
        };
        let entity = match action {
            Action::Wall(_) => "ruru",
            Action::Display(_) => "display",
        };
        let message = wire.message(&format!("{entity}/availability"), "offline");
        send(client, vec![message.clone()])?;
        self.published.insert(message.topic, message.payload);
        self.pending = Some((action, spawn(action)));
        Ok(())
    }

    fn complete(&mut self, action: Action, result: Result<(), String>) {
        let (status, wanted) = match action {
            Action::Wall(on) => (&mut self.wall_error, on),
            Action::Display(on) => (&mut self.display_error, on),
        };
        status.command = result.err().map(|error| (wanted, error));
    }

    async fn finish_completed(&mut self) -> Result<(), String> {
        if self
            .pending
            .as_ref()
            .is_some_and(|(_, job)| job.inner().is_finished())
        {
            let (action, job) = self.pending.take().expect("finished command exists");
            let result = job.await.map_err(|err| err.to_string())?;
            self.complete(action, result);
        }
        Ok(())
    }

    async fn report(&mut self, wire: &Wire<'_>, client: &AsyncClient) -> Result<usize, String> {
        self.finish_completed().await?;
        let display = if matches!(self.pending.as_ref(), Some((Action::Display(_), _))) {
            None
        } else {
            Some(super::mutter::state())
        };
        let messages = self.observe(wire, system::wall(), display, Instant::now());
        let count = messages.len();
        send(client, messages)?;
        Ok(count)
    }

    fn observe(
        &mut self,
        wire: &Wire<'_>,
        wall: Result<system::Wall, String>,
        display: Option<Result<bool, String>>,
        now: Instant,
    ) -> Vec<Message> {
        let pending = self.pending.as_ref().map(|(action, _)| action);
        let mut messages = Vec::new();
        let (wall_on, cpu, memory) = match wall {
            Ok(wall) => {
                let running = match wall.phase {
                    system::Phase::Running => Some(true),
                    system::Phase::Stopped => Some(false),
                    system::Phase::Changing => None,
                };
                self.wall_error.observed(running, wall.failure.clone());
                let cpu = self.cpu.sample(&wall, now);
                let memory = match running {
                    Some(false) => Some(0.0),
                    Some(true) => wall.memory.map(|bytes| bytes as f64 / 1_048_576.0),
                    None => None,
                };
                if matches!(pending, Some(Action::Wall(_))) {
                    (None, None, None)
                } else {
                    (running, cpu, memory)
                }
            }
            Err(err) => {
                self.wall_error.observed(None, Some(err));
                (None, None, None)
            }
        };
        let display_on = match display {
            Some(Ok(on)) => {
                self.display_error.observed(Some(on), None);
                Some(on)
            }
            Some(Err(err)) => {
                self.display_error.observed(None, Some(err));
                None
            }
            None => None,
        };
        for (object, value) in [
            ("ruru", wall_on.map(|on| on_off(on).into())),
            ("display", display_on.map(|on| on_off(on).into())),
            ("cpu", cpu.map(|value| format!("{value:.2}"))),
            ("memory", memory.map(|value| format!("{value:.2}"))),
        ] {
            let available = value.is_some();
            if let Some(value) = value {
                messages.push(wire.message(&format!("{object}/state"), value));
            }
            messages.push(wire.message(
                &format!("{object}/availability"),
                if available { "online" } else { "offline" },
            ));
        }
        for (object, error) in [
            ("ruru", self.wall_error.message()),
            ("display", self.display_error.message()),
        ] {
            messages.push(wire.message(
                &format!("{object}/attributes"),
                json!({ "error": error }).to_string(),
            ));
        }
        messages.retain(|message| self.published.get(&message.topic) != Some(&message.payload));
        for message in &messages {
            self.published
                .insert(message.topic.clone(), message.payload.clone());
        }
        messages
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_retained_redelivered_wrong_topic_and_wrong_payload_commands() {
        let topics = Topics::new("wall", "homeassistant");
        let device = device();
        let wire = Wire {
            topics: &topics,
            device: &device,
        };
        for (suffix, expected) in [
            ("command/ruru", Action::Wall(true)),
            ("command/display", Action::Display(true)),
        ] {
            let mut publish = Publish::new(wire.topic(suffix), QOS, b"ON".to_vec(), None);
            assert_eq!(wire.command(&publish), Some(expected));
            publish.retain = true;
            assert_eq!(wire.command(&publish), None);
            publish.retain = false;
            publish.dup = true;
            assert_eq!(wire.command(&publish), None);
            let filter = wire.filter(suffix);
            assert!(filter.preserve_retain);
            assert_eq!(filter.retain_forward_rule, RetainForwardRule::Never);
        }
        assert_eq!(
            wire.command(&Publish::new(
                wire.topic("command/ruru"),
                QOS,
                b"on".to_vec(),
                None
            )),
            None
        );
        assert_eq!(
            wire.command(&Publish::new(
                "ruru/other/agent/command/ruru",
                QOS,
                b"ON".to_vec(),
                None
            )),
            None
        );
    }

    #[test]
    fn reconnect_announces_the_same_display_entity_and_cleanup_removes_it() {
        let topics = Topics::new("wall", "homeassistant");
        let device = device();
        let wire = Wire {
            topics: &topics,
            device: &device,
        };
        let app = discovery::display_config(&topics, &device);
        let first = wire.discovery();
        assert_eq!(wire.discovery(), first);
        let agent = first
            .iter()
            .find(|message| message.topic == app.topic)
            .unwrap();
        let app_config: Value = serde_json::from_str(&app.payload).unwrap();
        let agent_config: Value = serde_json::from_str(&agent.payload).unwrap();
        assert_eq!(app_config["unique_id"], agent_config["unique_id"]);
        assert_eq!(
            app_config["device"]["identifiers"],
            agent_config["device"]["identifiers"]
        );
        assert_eq!(
            agent_config["availability"][0]["topic"],
            "ruru/wall/agent/availability"
        );
        assert_eq!(
            agent_config["command_topic"],
            "ruru/wall/agent/command/display"
        );
        assert_eq!(agent_config["retain"], false);
        assert!(
            wire.cleanup()
                .iter()
                .any(|message| message.topic == app.topic
                    && message.payload.is_empty()
                    && message.retain)
        );
    }

    fn wall(phase: system::Phase) -> Result<system::Wall, String> {
        Ok(system::Wall {
            phase,
            invocation: "test".into(),
            cpu: Some(0),
            memory: Some(0),
            failure: None,
        })
    }

    fn payload<'a>(wire: &Wire<'_>, messages: &'a [Message], suffix: &str) -> Option<&'a str> {
        let topic = wire.topic(suffix);
        messages
            .iter()
            .find(|message| message.topic == topic)
            .map(|message| message.payload.as_str())
    }

    #[test]
    fn bootstrap_preserves_live_commands_between_acknowledgements() {
        use rumqttc::v5::mqttbytes::v5::PubAck;

        let topics = Topics::new("wall", "homeassistant");
        let device = device();
        let wire = Wire {
            topics: &topics,
            device: &device,
        };
        let mut state = State::default();
        let mut collect = |event| state.enqueue_event(&wire, event);
        let mut count = 0;
        let ack = |pkid| {
            Event::Incoming(Packet::PubAck(PubAck {
                pkid,
                reason: PubAckReason::Success,
                properties: None,
            }))
        };
        acknowledge_event(ack(1), &mut count, &mut collect);
        let mut publish = Publish::new(wire.topic("command/ruru"), QOS, b"ON".to_vec(), None);
        publish.retain = true;
        acknowledge_event(
            Event::Incoming(Packet::Publish(publish.clone())),
            &mut count,
            &mut collect,
        );
        publish.retain = false;
        acknowledge_event(
            Event::Incoming(Packet::Publish(publish)),
            &mut count,
            &mut collect,
        );
        acknowledge_event(ack(2), &mut count, &mut collect);
        assert_eq!(count, 2);
        assert_eq!(state.queued, [Action::Wall(true)]);
    }

    #[test]
    fn serializes_service_jobs_and_publishes_off_after_a_failed_start() {
        async_runtime::block_on(async {
            let topics = Topics::new("wall", "homeassistant");
            let device = device();
            let wire = Wire {
                topics: &topics,
                device: &device,
            };
            let broker = Broker {
                host: "unused.invalid".into(),
                port: 1883,
                tls: false,
                username: String::new(),
                password: None,
            };
            let (client, _events) = connection(&broker, "test".into(), None).unwrap();
            let mut state = State::default();
            let now = Instant::now();
            let (complete, work) = tokio::sync::oneshot::channel();
            state.observe(&wire, wall(system::Phase::Stopped), Some(Ok(true)), now);
            state.enqueue(Action::Wall(true));
            state.enqueue(Action::Wall(false));
            state
                .start_next_with(&wire, &client, |action| {
                    assert_eq!(action, Action::Wall(true));
                    async_runtime::spawn(async move { work.await.expect("test result") })
                })
                .unwrap();
            assert_eq!(
                state
                    .published
                    .get(&wire.topic("ruru/availability"))
                    .map(String::as_str),
                Some("offline")
            );
            state
                .start_next_with(&wire, &client, |_| {
                    panic!("another command began before Start completed")
                })
                .unwrap();
            assert_eq!(state.queued, [Action::Wall(false)]);
            complete
                .send(Err("The app exited during startup.".into()))
                .unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while state.pending.is_some() {
                    state.finish_completed().await.unwrap();
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            let confirmed = state.observe(&wire, wall(system::Phase::Stopped), Some(Ok(true)), now);
            assert_eq!(
                payload(&wire, &confirmed, "ruru/availability"),
                Some("online")
            );
            assert_eq!(
                state
                    .published
                    .get(&wire.topic("ruru/state"))
                    .map(String::as_str),
                Some("OFF")
            );
            assert_eq!(state.error(), Some("The app exited during startup."));
            state
                .start_next_with(&wire, &client, |action| {
                    assert_eq!(action, Action::Wall(false));
                    async_runtime::spawn(async { Ok(()) })
                })
                .unwrap();
        });
    }

    #[test]
    fn reconnect_clears_old_commands_and_reannounces_the_same_snapshot() {
        let topics = Topics::new("wall", "homeassistant");
        let device = device();
        let wire = Wire {
            topics: &topics,
            device: &device,
        };
        let mut state = State::default();
        let now = Instant::now();
        let first = state.observe(&wire, wall(system::Phase::Stopped), Some(Ok(true)), now);
        assert_eq!(payload(&wire, &first, "ruru/state"), Some("OFF"));
        assert_eq!(payload(&wire, &first, "display/state"), Some("ON"));
        assert!(
            state
                .observe(&wire, wall(system::Phase::Stopped), Some(Ok(true)), now)
                .is_empty()
        );
        state.enqueue(Action::Wall(true));
        state.reconnect();
        assert!(state.queued.is_empty());
        assert_eq!(
            state.observe(&wire, wall(system::Phase::Stopped), Some(Ok(true)), now),
            first
        );
    }

    #[test]
    fn recovered_readback_clears_transient_errors_and_keeps_unresolved_command_errors() {
        let mut diagnostics = Diagnostics {
            command: Some((true, "start failed".into())),
            ..Default::default()
        };
        diagnostics.observed(None, Some("read failed".into()));
        assert_eq!(diagnostics.message(), Some("read failed"));
        diagnostics.observed(Some(false), None);
        assert_eq!(diagnostics.message(), Some("start failed"));
        diagnostics.observed(Some(true), None);
        assert_eq!(diagnostics.message(), None);
    }
}
