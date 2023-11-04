use chrono::{DateTime, Datelike, Local};
use comemo::Prehashed;
use fast_image_resize as fr;
use std::{
    cell::{OnceCell, RefCell, RefMut},
    collections::HashMap,
    path::{Path, PathBuf},
};
use typst::{
    diag::{FileError, FileResult, PackageError, PackageResult},
    doc::Document,
    eval::{Bytes, Datetime, Library, Tracer},
    font::{Font, FontBook},
    syntax::Source,
    syntax::{FileId, PackageSpec, VirtualPath},
    // util::PathExt,
    World,
};
use typst_library::prelude::EcoString;
use wasm_bindgen::prelude::*;
use web_sys::{ImageData, console};

mod diagnostic;
mod file_entry;
mod render;

use crate::{diagnostic::format_diagnostic, file_entry::FileEntry};

/// A world that provides access to the operating system.
#[wasm_bindgen]
pub struct SystemWorld {
    /// The root relative to which absolute paths are resolved.
    root: PathBuf,
    /// The input source.
    main: FileId,
    /// Typst's standard library.
    library: Prehashed<Library>,
    /// Metadata about discovered fonts.
    book: Prehashed<FontBook>,
    /// Storage of fonts
    fonts: Vec<Font>,

    files: RefCell<HashMap<FileId, FileEntry>>,

    now: OnceCell<DateTime<Local>>,

    packages: RefCell<HashMap<PackageSpec, PackageResult<PathBuf>>>,

    resizer: fr::Resizer,

    js_request_data: js_sys::Function,
}

#[wasm_bindgen]
impl SystemWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(root: String, js_read_file: &js_sys::Function) -> SystemWorld {
        console_error_panic_hook::set_once();

        let (book, fonts) = SystemWorld::start_embedded_fonts();

        Self {
            root: PathBuf::from(root),
            main: FileId::new(None, VirtualPath::new("")),
            library: Prehashed::new(typst_library::build()),
            book: Prehashed::new(book),
            fonts,
            files: RefCell::default(),
            now: OnceCell::new(),
            packages: RefCell::default(),
            resizer: fr::Resizer::default(),
            js_request_data: js_read_file.clone(),
        }
    }

    pub fn compile_image(
        &mut self,
        text: String,
        path: String,
        pixel_per_pt: f32,
        fill: String,
        size: u32,
        display: bool,
    ) -> Result<ImageData, JsValue> {
        let document = self.compile(text, path)?;
        render::to_image(
            &mut self.resizer,
            document,
            fill,
            pixel_per_pt,
            size,
            display,
        )
    }

    pub fn compile_svg(&mut self, text: String, path: String) -> Result<String, JsValue> {
        self.compile(text, path)
            .map(|document| render::to_svg(document))
    }

    fn compile(&mut self, text: String, path: String) -> Result<Document, JsValue> {
        self.reset();

        self.main = FileId::new(None, VirtualPath::new(path));
        self.files
            .borrow_mut()
            .insert(self.main, FileEntry::new(self.main, text));
        let mut tracer = Tracer::default();
        typst::compile(self, &mut tracer)
            .map_err(|errors| format_diagnostic(self.files.borrow(), &errors).into())
    }

    pub fn add_font(&mut self, data: Vec<u8>) {
        let buffer = Bytes::from(data);
        let mut font_infos = Vec::new();
        for font in Font::iter(buffer) {
            font_infos.push(font.info().clone());
            self.fonts.push(font)
        }
        if font_infos.len() > 0 {
            self.book.update(|b| {
                for info in font_infos {
                    b.push(info)
                }
            });
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
        self.source(self.main).unwrap()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        Ok(self.file_entry(id)?.source())
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        Ok(self.file_entry(id)?.bytes())
    }

    fn font(&self, index: usize) -> Option<Font> {
        Some(self.fonts[index].clone())
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = self.now.get_or_init(chrono::Local::now);

        let naive = match offset {
            None => now.naive_local(),
            Some(o) => now.naive_utc() + chrono::Duration::hours(o),
        };

        Datetime::from_ymd(
            naive.year(),
            naive.month().try_into().ok()?,
            naive.day().try_into().ok()?,
        )
    }
}

impl SystemWorld {
    fn reset(&mut self) {
        self.files.borrow_mut().clear();
        self.packages.borrow_mut().clear();
        self.now.take();
    }

    fn read_file(&self, path: &Path) -> FileResult<String> {
        let f = |e: JsValue| {
            if let Some(value) = e.as_f64() {
                return match value as i64 {
                    2 => FileError::NotFound(path.to_path_buf()),
                    3 => FileError::AccessDenied,
                    4 => FileError::IsDirectory,
                    _ => FileError::Other(Some(EcoString::from("see console for details"))),
                };
            }
            FileError::Other(e.as_string().map(EcoString::from))
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
            if let Some(num) = e.as_f64() {
                return match num as i64 {
                    2 => PackageError::NotFound(spec.clone()),
                    _ => PackageError::Other(Some(EcoString::from("see console for details"))),
                };
            }
            PackageError::Other(e.as_string().map(EcoString::from))
        };
        self.packages
            .borrow_mut()
            .entry(spec.clone())
            .or_insert_with(|| {
                Ok(self
                    .js_request_data
                    .call1(
                        &JsValue::NULL,
                        &format!("@{}/{}/{}", spec.namespace, spec.name, spec.version).into(),
                    )
                    .map_err(f)?
                    .as_string()
                    .unwrap()
                    .into())
            })
            .clone()
    }

    fn file_entry(&self, id: FileId) -> FileResult<RefMut<FileEntry>> {
        if let Ok(file) = RefMut::filter_map(self.files.borrow_mut(), |files| files.get_mut(&id)) {
            return Ok(file);
        }

        let path = match id.package() {
            Some(spec) => self.prepare_package(spec)?,
            None => self.root.clone(),
        };

        let text = self.read_file(&id.vpath().resolve(&path).ok_or(FileError::AccessDenied)?)?;

        Ok(RefMut::map(self.files.borrow_mut(), |files| {
            return files.entry(id).or_insert(FileEntry::new(id, text));
        }))
    }

    fn start_embedded_fonts() -> (FontBook, Vec<Font>) {
        let mut book = FontBook::new();
        let mut fonts = Vec::new();

        let mut process = |bytes: &'static [u8]| {
            let buffer = Bytes::from_static(bytes);
            for font in Font::iter(buffer) {
                book.push(font.info().clone());
                fonts.push(font);
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

        return (book, fonts);
    }
}
