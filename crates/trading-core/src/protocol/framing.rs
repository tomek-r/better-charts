use serde::{de::DeserializeOwned, Serialize};
use thiserror::Error;

use super::MAX_FRAME_SIZE;

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("frame payload is empty")]
    Empty,
    #[error("frame payload exceeds the configured limit")]
    TooLarge,
    #[error("invalid JSON payload: {0}")]
    InvalidJson(#[from] serde_json::Error),
}

/// Stateful decoder that accepts partial reads and multiple frames per read.
#[derive(Debug)]
pub struct FrameDecoder {
    pub(super) buffer: Vec<u8>,
    max_frame_size: usize,
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self::with_max_frame_size(MAX_FRAME_SIZE)
    }
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_max_frame_size(max_frame_size: usize) -> Self {
        Self {
            buffer: Vec::new(),
            max_frame_size,
        }
    }

    pub fn set_max_frame_size(&mut self, max_frame_size: usize) {
        self.max_frame_size = max_frame_size;
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, FrameError> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        let mut consumed = 0;
        loop {
            let remaining = &self.buffer[consumed..];
            if remaining.len() < 4 {
                break;
            }
            let length = u32::from_be_bytes(remaining[..4].try_into().expect("length")) as usize;
            if length == 0 {
                self.buffer.drain(..consumed);
                return Err(FrameError::Empty);
            }
            if length > self.max_frame_size {
                self.buffer.drain(..consumed);
                return Err(FrameError::TooLarge);
            }
            if remaining.len() < 4 + length {
                break;
            }
            let frame = remaining[4..4 + length].to_vec();
            consumed += 4 + length;
            frames.push(frame);
        }
        // Moving the unread suffix once keeps a coalesced batch linear in bytes.
        self.buffer.drain(..consumed);
        Ok(frames)
    }
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, FrameError> {
    encode_frame_with_limit(payload, MAX_FRAME_SIZE)
}

pub fn encode_frame_with_limit(
    payload: &[u8],
    max_frame_size: usize,
) -> Result<Vec<u8>, FrameError> {
    if payload.is_empty() {
        return Err(FrameError::Empty);
    }
    if payload.len() > max_frame_size || payload.len() > u32::MAX as usize {
        return Err(FrameError::TooLarge);
    }
    let mut output = Vec::with_capacity(4 + payload.len());
    output.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    output.extend_from_slice(payload);
    Ok(output)
}

pub fn encode_json<T: Serialize>(value: &T) -> Result<Vec<u8>, FrameError> {
    encode_frame(&serde_json::to_vec(value)?)
}

pub fn decode_json<T: DeserializeOwned>(payload: &[u8]) -> Result<T, FrameError> {
    if payload.is_empty() {
        return Err(FrameError::Empty);
    }
    serde_json::from_slice(payload).map_err(FrameError::InvalidJson)
}
