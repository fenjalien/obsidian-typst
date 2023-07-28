use typst::{
    font::{Font, FontBook},
    util::Bytes,
};
use wasm_bindgen::JsValue;

/// Searches for fonts.
pub struct FontSearcher {
    /// Metadata about all discovered fonts.
    pub book: FontBook,
    /// Slots that the fonts are loaded into.
    pub fonts: Vec<Font>,
}

impl FontSearcher {
    pub fn new() -> Self {
        Self {
            book: FontBook::new(),
            fonts: Vec::new(),
        }
    }


    // pub fn add_fonts(&mut self, ) -> Result<(), JsValue> {
    //     if let Some(window) = web_sys::window() {
    //     }
    // }
}
