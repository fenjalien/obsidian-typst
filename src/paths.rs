use std::{cell::OnceCell, hash::Hash, path::PathBuf};

use siphasher::sip128::{Hasher128, SipHasher13};
use typst::{diag::FileResult, file::FileId, syntax::Source, util::Bytes};

/// Holds canonical data for all pahts pointing to the same entity.
///
/// Both fields can be populated if the file is both imported and read().
pub struct PathSlot {
    /// The slot's canonical file id.
    pub id: FileId,
    /// The slot's path on the system.
    pub system_path: PathBuf,
    /// The loaded buffer for a path hash.
    pub buffer: FileResult<Bytes>,
    /// The lazily loaded source file for a path hash.
    pub source: OnceCell<FileResult<Source>>,
}

impl PathSlot {
    pub fn source(&self) -> FileResult<Source> {
        self.source
            .get_or_init(|| {
                Ok(Source::new(
                    self.id,
                    String::from_utf8(self.buffer.clone()?.to_vec())?,
                ))
            })
            .clone()
    }

    pub fn file(&self) -> FileResult<Bytes> {
        self.buffer.clone()
    }
}

/// A hash that is the same for all paths pointing to the same entity.
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub struct PathHash(u128);

impl PathHash {
    pub fn new(bytes: &Bytes) -> Self {
        let mut state = SipHasher13::new();
        bytes.hash(&mut state);
        Self(state.finish128().as_u128())
    }
}
