use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::time::sleep;

#[derive(Debug, Error)]
enum GatewayError {
    #[error("mqtt error: {0}")]
    Mqtt(#[from] rumqttc::ConnectionError),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
}

#[derive(Debug, Serialize, Deserialize)]
struct RawAnalyticsEvent {
    #[serde(default)]
    device_id: String,
    #[serde(default)]
    zone_id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct VirtualObjectEvent {
    event_id: String,
    ts_unix_ms: u64,
    device_id: String,
    zone_id: String,
    category: String,
    fields: serde_json::Value,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64
}

fn normalize_event(raw: RawAnalyticsEvent) -> VirtualObjectEvent {
    let ts = now_ms();
    let event_id = format!(
        "voevt_{}_{}",
        ts,
        rand_fragment()
    );
    let category = if raw.kind.is_empty() {
        "analytics".to_string()
    } else {
        raw.kind
    };
    VirtualObjectEvent {
        event_id,
        ts_unix_ms: ts,
        device_id: raw.device_id,
        zone_id: raw.zone_id,
        category,
        fields: raw.payload,
    }
}

fn rand_fragment() -> String {
    // Simple non-cryptographic fragment for IDs
    let n = now_ms() ^ 0x5f37_9bcd;
    format!("{:x}", n & 0xfffff)
}

async fn run_gateway() -> Result<(), GatewayError> {
    let mut mqttoptions = MqttOptions::new("jetson-gateway", "localhost", 1883);
    mqttoptions.set_keep_alive(Duration::from_secs(30));

    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);

    // Subscribe to generic analytics topics; these can be refined per deployment.
    client
        .subscribe("analytics/+/events", QoS::AtLeastOnce)
        .await
        .unwrap();

    println!("jetson-gateway: subscribed to analytics/+/events");

    loop {
        let event = eventloop.poll().await?;
        if let Event::Incoming(Incoming::Publish(p)) = event {
            if let Ok(text) = String::from_utf8(p.payload.to_vec()) {
                match serde_json::from_str::<RawAnalyticsEvent>(&text) {
                    Ok(raw) => {
                        let voevt = normalize_event(raw);
                        let out = serde_json::to_string(&voevt)?;
                        // For now, print to stdout; later, forward to a local
                        // Javaspectre ingestion socket or file.
                        println!("{}", out);
                    }
                    Err(err) => {
                        eprintln!("jetson-gateway: JSON parse error: {err}");
                    }
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    loop {
        match run_gateway().await {
            Ok(()) => break,
            Err(err) => {
                eprintln!("jetson-gateway error: {err}; retrying in 3s");
                sleep(Duration::from_secs(3)).await;
            }
        }
    }
}
