use std::cell::OnceCell;

use typst::{
    foundations::Bytes,
    syntax::{FileId, Source},
};

pub struct FileEntry {
    bytes: OnceCell<Bytes>,
    source: Source,
}

impl FileEntry {
    pub fn new(id: FileId, text: String) -> Self {
        Self {
            bytes: OnceCell::new(),
            source: Source::new(id, text),
        }
    }

    pub fn source(&self) -> Source {
        self.source.clone()
    }

    pub fn bytes(&self) -> Bytes {
        self.bytes
            .get_or_init(|| Bytes::from(self.source.text().as_bytes()))
            .clone()
    }
}
