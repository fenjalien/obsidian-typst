use comemo::Prehashed;
use std::{
    cell::{OnceCell, RefCell, RefMut},
    collections::HashMap,
    path::{Path, PathBuf},
    str::FromStr,
};
use typst::{
    diag::{FileError, FileResult, PackageError, PackageResult},
    eval::{Datetime, Library},
    file::{FileId, PackageSpec},
    font::{Font, FontBook},
    geom::{Color, RgbaColor},
    syntax::Source,
    util::{Bytes, PathExt},
    World,
};
use wasm_bindgen::{prelude::*, Clamped};
use web_sys::{console, ImageData};

mod fonts;
mod paths;

use crate::fonts::FontSearcher;
use crate::paths::{PathHash, PathSlot};

/// A world that provides access to the operating system.
#[wasm_bindgen]
pub struct SystemWorld {
    /// The root relative to which absolute paths are resolved.
    root: PathBuf,
    /// The input source.
    main: Source,
    /// Typst's standard library.
    library: Prehashed<Library>,
    /// Metadata about discovered fonts.
    book: Prehashed<FontBook>,
    /// Storage of fonts
    fonts: Vec<Font>,
    /// Maps package-path combinations to canonical hashes. All package-path
    /// combinations that point to thes same file are mapped to the same hash. To
    /// be used in conjunction with `paths`.
    hashes: RefCell<HashMap<FileId, FileResult<PathHash>>>,
    /// Maps canonical path hashes to source files and buffers.
    paths: RefCell<HashMap<PathHash, PathSlot>>,
    /// The current date if requested. This is stored here to ensure it is
    /// always the same within one compilation. Reset between compilations.
    today: OnceCell<Option<Datetime>>,

    packages: RefCell<HashMap<PackageSpec, PackageResult<PathBuf>>>,

    js_request_data: js_sys::Function,
}

#[wasm_bindgen]
impl SystemWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(root: String, js_read_file: &js_sys::Function) -> SystemWorld {
        console_error_panic_hook::set_once();
        let mut searcher = FontSearcher::new();
        searcher.add_embedded();

        Self {
            root: PathBuf::from(root),
            main: Source::detached(String::new()),
            library: Prehashed::new(typst_library::build()),
            book: Prehashed::new(searcher.book),
            fonts: searcher.fonts,
            hashes: RefCell::default(),
            paths: RefCell::default(),
            today: OnceCell::new(),
            packages: RefCell::default(),
            js_request_data: js_read_file.clone(),
        }
    }

    fn reset(&mut self) {
        self.hashes.borrow_mut().clear();
        self.paths.borrow_mut().clear();
        self.today.take();
    }

    pub fn compile(
        &mut self,
        source: String,
        path: String,
        pixel_per_pt: f32,
        fill: String,
    ) -> Result<ImageData, JsValue> {
        self.reset();
        self.main = Source::new(FileId::new(None, &PathBuf::from(path)), source);

        match typst::compile(self) {
            Ok(document) => {
                let render = typst::export::render(
                    &document.pages[0],
                    pixel_per_pt,
                    Color::Rgba(RgbaColor::from_str(&fill)?),
                );
                ImageData::new_with_u8_clamped_array_and_sh(
                    Clamped(render.data()),
                    render.width(),
                    render.height(),
                )
            }
            Err(errors) => Err(format!("{:?}", *errors).into()),
        }
    }
}

impl World for SystemWorld {
    fn library(&self) -> &Prehashed<Library> {
        &self.library
    }

    fn book(&self) -> &Prehashed<FontBook> {
        &self.book
    }

    fn main(&self) -> Source {
        self.main.clone()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.slot(id)?.source()
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.slot(id)?.file()
    }

    fn font(&self, index: usize) -> Option<Font> {
        Some(self.fonts[index].clone())
    }

    fn today(&self, _: Option<i64>) -> Option<Datetime> {
        None
    }
}

impl SystemWorld {
    fn read_file(&self, path: &Path) -> FileResult<String> {
        let f = |e: JsValue| {
            console::error_1(&e);
            FileError::Other
        };
        Ok(self
            .js_request_data
            .call1(&JsValue::NULL, &path.to_str().unwrap().into())
            .map_err(f)?
            .as_string()
            .unwrap())
    }

    fn prepare_package(&self, spec: &PackageSpec) -> PackageResult<PathBuf> {
        let f = |e: JsValue| {
            console::error_1(&e);
            PackageError::Other
        };
        self.packages
            .borrow_mut()
            .entry(spec.clone())
            .or_insert_with(|| {
                Ok(self
                    .js_request_data
                    .call1(
                        &JsValue::NULL,
                        &format!("@{}/{}-{}", spec.namespace, spec.name, spec.version).into(),
                    )
                    .map_err(f)?
                    .as_string()
                    .unwrap()
                    .into())
            })
            .clone()
    }

    fn slot(&self, id: FileId) -> FileResult<RefMut<PathSlot>> {
        let mut system_path = PathBuf::new();
        let mut text = String::new();
        let hash = self
            .hashes
            .borrow_mut()
            .entry(id)
            .or_insert_with(|| {
                let root = match id.package() {
                    Some(spec) => self.prepare_package(spec)?,
                    None => self.root.clone(),
                };

                system_path = root.join_rooted(id.path()).ok_or(FileError::AccessDenied)?;
                // buffer = self.read(&system_path)?;
                text = self.read_file(&system_path)?;

                Ok(PathHash::new(&text))
            })
            .clone()?;

        Ok(RefMut::map(self.paths.borrow_mut(), |paths| {
            paths.entry(hash).or_insert_with(|| PathSlot {
                id,
                source: Ok(Source::new(id, text)),
                buffer: OnceCell::new(),
                system_path,
            })
        }))
    }
}
