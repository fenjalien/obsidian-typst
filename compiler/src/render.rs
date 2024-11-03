use fast_image_resize::{self as fr, images::Image};
use fr::Resizer;
use typst::model::Document;
use wasm_bindgen::Clamped;
use web_sys::ImageData;

pub fn to_image(
    resizer: &mut Resizer,
    document: Document,
    pixel_per_pt: f32,
    size: u32,
    display: bool,
) -> Result<ImageData, wasm_bindgen::JsValue> {
    let mut pixmap = typst_render::render(&document.pages[0], pixel_per_pt);

    let width = pixmap.width();
    let height = pixmap.height();
    // Create src image
    let mut src_image =
        Image::from_slice_u8(width, height, pixmap.data_mut(), fr::PixelType::U8x4).unwrap();

    // Multiple RGB channels of source image by alpha channel
    let alpha_mul_div = fr::MulDiv::default();
    alpha_mul_div
        .multiply_alpha_inplace(&mut src_image)
        .unwrap();

    let dst_width = if display {
        size
    } else {
        ((size as f32 / height as f32) * width as f32) as u32
    };
    let dst_height = if display {
        ((size as f32 / width as f32) * height as f32) as u32
    } else {
        size
    };

    // Create container for data of destination image
    let mut dst_image = Image::new(dst_width, dst_height, src_image.pixel_type());

    // Resize source image into buffer of destination image
    resizer.resize(&src_image, &mut dst_image, None).unwrap();

    alpha_mul_div.divide_alpha_inplace(&mut dst_image).unwrap();

    return ImageData::new_with_u8_clamped_array_and_sh(
        Clamped(dst_image.buffer()),
        dst_width,
        dst_height,
    );
}

pub fn to_svg(document: Document) -> String {
    typst_svg::svg(&document.pages[0])
}
