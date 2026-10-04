//! Synthetic loopback benchmark; never connects to MT5 or reads account data.
use std::{
    error::Error,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
use trading_core::protocol::{
    decode_json, encode_frame_with_limit, Envelope, FrameDecoder, MarketTick, MessageType,
    TickHistorySnapshot, PROTOCOL_VERSION,
};

fn median(samples: &mut [f64]) -> f64 {
    samples.sort_by(f64::total_cmp);
    samples[samples.len() / 2]
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("ticks,payload_mib,serialize_ms,receive_decode_validate_ms,mib_per_second");
    for count in [5_000, 10_000, 20_000, 40_000, 65_535, 125_000, 250_000] {
        let snapshot = TickHistorySnapshot {
            request_id: "synthetic-page".into(),
            symbol: "TEST.SYNTHETIC".into(),
            from_ms: 1_700_000_000_000,
            to_ms: 1_700_001_000_000,
            tick_size: "0.1".into(),
            complete: true,
            ticks: (0..count)
                .map(|index| MarketTick {
                    time_ms: 1_700_000_000_000 + index,
                    bid: "25000.1".into(),
                    ask: "25000.3".into(),
                    last: "0.0".into(),
                    volume: 0,
                    volume_real: "0.00000000".into(),
                    flags: 6,
                })
                .collect(),
        };
        let message = Envelope {
            v: PROTOCOL_VERSION,
            message_type: MessageType::TickHistorySnapshot,
            id: "synthetic-envelope".into(),
            session_id: Some("synthetic-session".into()),
            sent_at_ms: 1_700_001_000_000,
            payload: serde_json::to_value(&snapshot)?,
        };
        let mut serialized = Vec::new();
        let mut serialize_samples = Vec::new();
        for _ in 0..5 {
            let started = Instant::now();
            serialized = serde_json::to_vec(&message)?;
            serialize_samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        }
        let frame = encode_frame_with_limit(&serialized, serialized.len())?;
        let limit = serialized.len();
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let address = listener.local_addr()?;
        let receiver = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut decoder = FrameDecoder::with_max_frame_size(limit);
            let mut buffer = [0u8; 8192];
            let mut samples = Vec::new();
            for _ in 0..5 {
                let started = Instant::now();
                let payload = loop {
                    let read = socket.read(&mut buffer).unwrap();
                    assert_ne!(read, 0);
                    let mut frames = decoder.push(&buffer[..read]).unwrap();
                    if !frames.is_empty() {
                        assert_eq!(frames.len(), 1);
                        break frames.remove(0);
                    }
                };
                let envelope: Envelope = decode_json(&payload).unwrap();
                let page: TickHistorySnapshot = serde_json::from_value(envelope.payload).unwrap();
                assert_eq!(page.ticks.len() as i64, count);
                for tick in &page.ticks {
                    tick.validate().unwrap();
                }
                samples.push(started.elapsed().as_secs_f64() * 1_000.0);
                socket.write_all(&[1]).unwrap();
            }
            samples
        });
        let mut sender = TcpStream::connect(address)?;
        sender.set_nodelay(true)?;
        sender.set_write_timeout(Some(Duration::from_secs(10)))?;
        for _ in 0..5 {
            sender.write_all(&frame)?;
            let mut ack = [0];
            sender.read_exact(&mut ack)?;
        }
        let mut receive_samples = receiver.join().map_err(|_| "receiver failed")?;
        let mib = limit as f64 / (1024.0 * 1024.0);
        let receive_ms = median(&mut receive_samples);
        println!(
            "{count},{mib:.3},{:.3},{receive_ms:.3},{:.1}",
            median(&mut serialize_samples),
            mib / (receive_ms / 1_000.0)
        );
    }
    Ok(())
}
