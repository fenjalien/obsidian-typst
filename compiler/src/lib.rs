use fast_image_resize as fr;
use wasm_bindgen::prelude::*;
use web_sys::ImageData;

mod diagnostic;
mod file_entry;
mod render;
mod world;

use crate::world::SystemWorld;

#[wasm_bindgen]
pub struct Compiler {
    resizer: fr::Resizer,
    world: SystemWorld,
}

#[wasm_bindgen]
impl Compiler {
    #[wasm_bindgen(constructor)]
    pub fn new(root: String, request_data: &js_sys::Function) -> Self {
        console_error_panic_hook::set_once();

        Self {
            world: SystemWorld::new(root, request_data),
            resizer: fr::Resizer::default(),
        }
    }

    pub fn compile_image(
        &mut self,
        text: String,
        path: String,
        pixel_per_pt: f32,
        size: u32,
        display: bool,
    ) -> Result<ImageData, JsValue> {
        let document = self.world.compile(text, path)?;
        render::to_image(
            &mut self.resizer,
            document,
            pixel_per_pt,
            size,
            display,
        )
    }

    pub fn compile_svg(&mut self, text: String, path: String) -> Result<String, JsValue> {
        self.world
            .compile(text, path)
            .map(|document| render::to_svg(document))
    }

    pub fn add_font(&mut self, data: Vec<u8>) {
        self.world.add_font(data);
    }
}
