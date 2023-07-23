use comemo::Prehashed;
use fast_image_resize as fr;
use std::{
    cell::{OnceCell, RefCell, RefMut},
    collections::HashMap,
    num::NonZeroU32,
    path::{Path, PathBuf},
    str::FromStr,
};
use typst::{
    diag::{EcoString, FileError, FileResult, PackageError, PackageResult},
    eval::{Datetime, Library},
    file::{FileId, PackageSpec},
    font::{Font, FontBook},
    geom::{Color, RgbaColor},
    syntax::Source,
    util::{Bytes, PathExt},
    World,
};
use wasm_bindgen::{prelude::*, Clamped};
use web_sys::ImageData;

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
    main: FileId,
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

    resizer: fr::Resizer,

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
            main: FileId::detached(),
            library: Prehashed::new(typst_library::build()),
            book: Prehashed::new(searcher.book),
            fonts: searcher.fonts,
            hashes: RefCell::default(),
            paths: RefCell::default(),
            today: OnceCell::new(),
            packages: RefCell::default(),
            resizer: fr::Resizer::default(),
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
        text: String,
        path: String,
        pixel_per_pt: f32,
        fill: String,
        size: u32,
        display: bool,
    ) -> Result<ImageData, JsValue> {
        self.reset();

        // Insert the main path slot
        let system_path = PathBuf::from(path);
        let hash = PathHash::new(&text);
        self.main = FileId::new(None, &system_path);
        self.hashes.borrow_mut().insert(self.main, Ok(hash));
        self.paths.borrow_mut().insert(
            hash,
            PathSlot {
                id: self.main,
                system_path,
                buffer: OnceCell::new(),
                source: Ok(Source::new(self.main, text)),
            },
        );

        match typst::compile(self) {
            Ok(document) => {
                let mut pixmap = typst::export::render(
                    &document.pages[0],
                    pixel_per_pt,
                    Color::Rgba(RgbaColor::from_str(&fill)?),
                );

                let width = pixmap.width();
                let height = pixmap.height();
                // Create src image
                let mut src_image = fr::Image::from_slice_u8(
                    NonZeroU32::new(width).unwrap(),
                    NonZeroU32::new(height).unwrap(),
                    pixmap.data_mut(),
                    fr::PixelType::U8x4,
                )
                .unwrap();

                // Multiple RGB channels of source image by alpha channel
                let alpha_mul_div = fr::MulDiv::default();
                alpha_mul_div
                    .multiply_alpha_inplace(&mut src_image.view_mut())
                    .unwrap();

                let dst_width = NonZeroU32::new(if display {
                    size
                } else {
                    ((size as f32 / height as f32) * width as f32) as u32
                })
                .unwrap_or(NonZeroU32::MIN);
                let dst_height = NonZeroU32::new(if display {
                    ((size as f32 / width as f32) * height as f32) as u32
                } else {
                    size
                })
                .unwrap_or(NonZeroU32::MIN);

                // Create container for data of destination image
                let mut dst_image = fr::Image::new(dst_width, dst_height, src_image.pixel_type());
                // Get mutable view of destination image data
                let mut dst_view = dst_image.view_mut();

                // Resize source image into buffer of destination image
                self.resizer
                    .resize(&src_image.view(), &mut dst_view)
                    .unwrap();

                alpha_mul_div.divide_alpha_inplace(&mut dst_view).unwrap();

                ImageData::new_with_u8_clamped_array_and_sh(
                    Clamped(dst_image.buffer()),
                    dst_width.get(),
                    dst_height.get(),
                )
            }
            Err(errors) => Err(format!(
                "{:?}",
                errors
                    .into_iter()
                    .map(|e| e.message)
                    .collect::<Vec<EcoString>>()
            )
            .into()),
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
        let f = |_e: JsValue| FileError::Other;
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
                if num == -2.0 {
                    return PackageError::NotFound(spec.clone());
                }
            }
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
