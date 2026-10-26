//! The text limits a drawing scope and a drawing record share.

/// Whether `text` is present and no longer than `max_bytes`. Byte length is what a
/// stored file occupies, so the limits are stated in bytes.
pub(super) fn is_present_within(text: &str, max_bytes: usize) -> bool {
    !text.is_empty() && text.len() <= max_bytes
}
