// SPDX-License-Identifier: AGPL-3.0-only
// Validate framing before rmpv decodes: rmpv treats the reserved 0xc1 marker as nil.
// This also bounds collection sizes before the decoder allocates their storage.
struct Validator<'a> {
    bytes: &'a [u8],
    offset: usize,
    remaining_nodes: usize,
}
impl Validator<'_> {
    fn take(&mut self, length: usize) -> Result<&[u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or("MessagePack length overflow.")?;
        let slice = self
            .bytes
            .get(self.offset..end)
            .ok_or("Truncated MessagePack value.")?;
        self.offset = end;
        Ok(slice)
    }
    fn length(&mut self, width: usize) -> Result<usize, String> {
        Ok(self
            .take(width)?
            .iter()
            .fold(0usize, |length, byte| (length << 8) | usize::from(*byte)))
    }
    fn value(&mut self, depth: usize) -> Result<(), String> {
        if depth > 64 || self.remaining_nodes == 0 {
            return Err("MessagePack exceeds 64 levels or 50,000 nodes.".into());
        }
        self.remaining_nodes -= 1;
        let marker = self.take(1)?[0];
        let mut children = 0;
        let mut payload = 0;
        match marker {
            0x00..=0x7f | 0xe0..=0xff | 0xc0 | 0xc2 | 0xc3 => {}
            0xc1 => return Err("Reserved MessagePack marker 0xc1.".into()),
            0x80..=0x8f => children = usize::from(marker & 0x0f) * 2,
            0x90..=0x9f => children = usize::from(marker & 0x0f),
            0xa0..=0xbf => payload = usize::from(marker & 0x1f),
            0xc4 | 0xd9 => payload = self.length(1)?,
            0xc5 | 0xda => payload = self.length(2)?,
            0xc6 | 0xdb => payload = self.length(4)?,
            0xc7..=0xc9 => {
                let width = 1usize << (marker - 0xc7);
                payload = self
                    .length(width)?
                    .checked_add(1)
                    .ok_or("Extension length overflow.")?;
            }
            0xca | 0xce | 0xd2 => payload = 4,
            0xcb | 0xcf | 0xd3 => payload = 8,
            0xcc | 0xd0 => payload = 1,
            0xcd | 0xd1 => payload = 2,
            0xd4..=0xd8 => payload = (1usize << (marker - 0xd4)) + 1,
            0xdc => children = self.length(2)?,
            0xdd => children = self.length(4)?,
            0xde => children = self.length(2)? * 2,
            0xdf => {
                children = self
                    .length(4)?
                    .checked_mul(2)
                    .ok_or("Map length overflow.")?
            }
        }
        self.take(payload)?;
        if children > self.remaining_nodes {
            return Err("MessagePack exceeds 50,000 nodes.".into());
        }
        for _ in 0..children {
            self.value(depth + 1)?;
        }
        Ok(())
    }
}
pub fn validate(bytes: &[u8]) -> Result<(), String> {
    let mut validator = Validator {
        bytes,
        offset: 0,
        remaining_nodes: 50_000,
    };
    validator.value(0)?;
    if validator.offset != bytes.len() {
        return Err("Trailing bytes found. Provide exactly one encoded value.".into());
    }
    Ok(())
}
