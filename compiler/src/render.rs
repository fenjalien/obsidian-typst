use std::{num::NonZeroU32, str::FromStr};

use fast_image_resize as fr;
use fr::Resizer;
use typst::{
    doc::Document,
    geom::{Color, RgbaColor},
};
use wasm_bindgen::Clamped;
use web_sys::ImageData;

pub fn to_image(
    resizer: &mut Resizer,
    document: Document,
    fill: String,
    pixel_per_pt: f32,
    size: u32,
    display: bool,
) -> Result<ImageData, wasm_bindgen::JsValue> {
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
    resizer.resize(&src_image.view(), &mut dst_view).unwrap();

    alpha_mul_div.divide_alpha_inplace(&mut dst_view).unwrap();

    return ImageData::new_with_u8_clamped_array_and_sh(
        Clamped(dst_image.buffer()),
        dst_width.get(),
        dst_height.get(),
    );
}

pub fn to_svg(document: Document) -> String {
    typst::export::svg(&document.pages[0])
}
