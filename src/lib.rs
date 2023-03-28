use comemo::Prehashed;
use elsa::FrozenVec;
use js_sys::Uint8Array;
use once_cell::unsync::OnceCell;
use siphasher::sip128::{Hasher128, SipHasher};
use std::{
    cell::{RefCell, RefMut},
    collections::HashMap,
    hash::Hash,
    path::{Path, PathBuf},
    str::FromStr,
};
use typst::{
    diag::{FileError, FileResult},
    eval::Library,
    font::{Font, FontBook, FontInfo},
    geom::{Color, RgbaColor},
    syntax::{Source, SourceId},
    util::{Buffer, PathExt},
    World,
};
use wasm_bindgen::{prelude::*, Clamped};
use wasm_bindgen_futures::JsFuture;
use web_sys::{console, Blob, FontData, ImageData};

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen(module = "fs")]
extern "C" {
    #[wasm_bindgen(catch)]
    fn readFileSync(path: &str) -> Result<JsValue, JsValue>;
}
#[wasm_bindgen(module = "utils")]
extern "C" {
    async fn get_fonts() -> JsValue;
    async fn get_local_fonts() -> JsValue;
}

/// A world that provides access to the operating system.
#[wasm_bindgen]
pub struct SystemWorld {
    root: PathBuf,
    library: Prehashed<Library>,
    book: Prehashed<FontBook>,
    fonts: Vec<FontSlot>,
    hashes: RefCell<HashMap<PathBuf, FileResult<PathHash>>>,
    paths: RefCell<HashMap<PathHash, PathSlot>>,
    sources: FrozenVec<Box<Source>>,
    main: SourceId,
}

#[wasm_bindgen]
impl SystemWorld {
    #[wasm_bindgen(constructor)]
    pub async fn new(root: String) -> Result<SystemWorld, JsValue> {
        let mut searcher = FontSearcher::new();
        searcher.search_system().await?;

        Ok(Self {
            root: PathBuf::from(root),
            library: Prehashed::new(typst_library::build()),
            book: Prehashed::new(searcher.book),
            fonts: searcher.fonts,
            hashes: RefCell::default(),
            paths: RefCell::default(),
            sources: FrozenVec::new(),
            main: SourceId::detached(),
        })
    }

    pub fn compile(
        &mut self,
        source: String,
        pixel_per_pt: f32,
        fill: String,
    ) -> Result<ImageData, JsValue> {
        self.main = self.insert("<user input>".as_ref(), source);
        match typst::compile(self) {
            Ok(document) => {
                let render = typst::export::render(
                    &document.pages[0],
                    pixel_per_pt,
                    Color::Rgba(RgbaColor::from_str(&fill)?),
                );
                Ok(ImageData::new_with_u8_clamped_array_and_sh(
                    Clamped(render.data()),
                    render.width(),
                    render.height(),
                )?)
            }
            Err(errors) => Err(format!("{:?}", *errors).into()),
        }
    }
}

impl World for SystemWorld {
    fn root(&self) -> &Path {
        &self.root
    }

    fn library(&self) -> &Prehashed<Library> {
        &self.library
    }

    fn main(&self) -> &Source {
        self.source(self.main)
    }

    fn resolve(&self, path: &Path) -> FileResult<SourceId> {
        self.slot(path)?
            .source
            .get_or_init(|| {
                let buf = read(path)?;
                let text = String::from_utf8(buf)?;
                Ok(self.insert(path, text))
            })
            .clone()
    }

    fn source(&self, id: SourceId) -> &Source {
        &self.sources[id.into_u16() as usize]
    }

    fn book(&self) -> &Prehashed<FontBook> {
        &self.book
    }

    fn font(&self, id: usize) -> Option<Font> {
        let slot = &self.fonts[id];
        slot.font
            .get_or_init(|| Font::new(slot.buffer.clone(), slot.index))
            .clone()
    }

    fn file(&self, path: &Path) -> FileResult<Buffer> {
        self.slot(path)?
            .buffer
            .get_or_init(|| read(path).map(Buffer::from))
            .clone()
    }
}

impl SystemWorld {
    fn slot(&self, path: &Path) -> FileResult<RefMut<PathSlot>> {
        let mut hashes = self.hashes.borrow_mut();
        let hash = match hashes.get(path).cloned() {
            Some(hash) => hash,
            None => {
                let hash = PathHash::new(path);
                if let Ok(canon) = path.canonicalize() {
                    hashes.insert(canon.normalize(), hash.clone());
                }
                hashes.insert(path.into(), hash.clone());
                hash
            }
        }?;

        Ok(std::cell::RefMut::map(self.paths.borrow_mut(), |paths| {
            paths.entry(hash).or_default()
        }))
    }

    fn insert(&self, path: &Path, text: String) -> SourceId {
        let id = SourceId::from_u16(self.sources.len() as u16);
        let source = Source::new(id, path, text);
        self.sources.push(Box::new(source));
        id
    }
}

fn read(path: &Path) -> FileResult<Vec<u8>> {
    let f = |e: JsValue| {
        console::log_1(&e);
        FileError::Other
    };

    Ok(Uint8Array::new(&readFileSync(path.to_str().unwrap()).map_err(f)?).to_vec())
}

/// Holds details about the location of a font and lazily the font itself.
struct FontSlot {
    buffer: Buffer,
    index: u32,
    font: OnceCell<Option<Font>>,
}

/// A hash that is the same for all paths pointing to the same entity.
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
struct PathHash(u128);

impl PathHash {
    fn new(path: &Path) -> FileResult<Self> {
        let handle = Buffer::from(read(path)?);
        let mut state = SipHasher::new();
        handle.hash(&mut state);
        Ok(Self(state.finish128().as_u128()))
    }
}

/// Holds canonical data for all paths pointing to the same entity.
#[derive(Default)]
struct PathSlot {
    source: OnceCell<FileResult<SourceId>>,
    buffer: OnceCell<FileResult<Buffer>>,
}

struct FontSearcher {
    book: FontBook,
    fonts: Vec<FontSlot>,
}

impl FontSearcher {
    fn new() -> Self {
        Self {
            book: FontBook::new(),
            fonts: vec![],
        }
    }

    fn add_embedded(&mut self) {
        let mut add = |bytes: &'static [u8]| {
            let buffer = Buffer::from_static(bytes);
            for (i, font) in Font::iter(buffer.clone()).enumerate() {
                self.book.push(font.info().clone());
                self.fonts.push(FontSlot {
                    buffer: buffer.clone(),
                    index: i as u32,
                    font: OnceCell::from(Some(font)),
                });
            }
        };

        // Embed default fonts.
        add(include_bytes!("../assets/fonts/LinLibertine_R.ttf"));
        add(include_bytes!("../assets/fonts/LinLibertine_RB.ttf"));
        add(include_bytes!("../assets/fonts/LinLibertine_RBI.ttf"));
        add(include_bytes!("../assets/fonts/LinLibertine_RI.ttf"));
        add(include_bytes!("../assets/fonts/NewCMMath-Book.otf"));
        add(include_bytes!("../assets/fonts/NewCMMath-Regular.otf"));
        add(include_bytes!("../assets/fonts/DejaVuSansMono.ttf"));
        add(include_bytes!("../assets/fonts/DejaVuSansMono-Bold.ttf"));
        add(include_bytes!("../assets/fonts/DejaVuSansMono-Oblique.ttf"));
        add(include_bytes!(
            "../assets/fonts/DejaVuSansMono-BoldOblique.ttf"
        ));
    }

    async fn search_system(&mut self) -> Result<(), JsValue> {
        self.add_embedded();
        if let Some(window) = web_sys::window() {
            for fontdata in JsFuture::from(window.query_local_fonts()?)
                .await?
                .dyn_into::<js_sys::Array>()?
                .to_vec()
            {
                let buffer = Buffer::from(
                    js_sys::Uint8Array::new(
                        &JsFuture::from(
                            JsFuture::from(fontdata.dyn_into::<FontData>()?.blob())
                                .await?
                                .dyn_into::<Blob>()?
                                .array_buffer(),
                        )
                        .await?,
                    )
                    .to_vec(),
                );
                for (i, info) in FontInfo::iter(buffer.as_slice()).enumerate() {
                    self.book.push(info);
                    self.fonts.push(FontSlot {
                        buffer: buffer.clone(),
                        index: i as u32,
                        font: OnceCell::new(),
                    })
                }
            }
        }
        Ok(())
    }
}
