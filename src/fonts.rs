use typst::{
    font::{Font, FontBook},
    util::Bytes,
};

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

    pub fn add_embedded(&mut self) {
        let mut process = |bytes: &'static [u8]| {
            let buffer = Bytes::from_static(bytes);
            for font in Font::iter(buffer) {
                self.book.push(font.info().clone());
                self.fonts.push(font);
            }
        };

        macro_rules! add {
            ($filename:literal) => {
                process(include_bytes!(concat!("../assets/fonts/", $filename)));
            };
        }

        // Embed default fonts.
        add!("LinLibertine_R.ttf");
        add!("LinLibertine_RB.ttf");
        add!("LinLibertine_RBI.ttf");
        add!("LinLibertine_RI.ttf");
        add!("NewCMMath-Book.otf");
        add!("NewCMMath-Regular.otf");
        add!("DejaVuSansMono.ttf");
        add!("DejaVuSansMono-Bold.ttf");
        add!("DejaVuSansMono-Oblique.ttf");
        add!("DejaVuSansMono-BoldOblique.ttf");
    }
}
