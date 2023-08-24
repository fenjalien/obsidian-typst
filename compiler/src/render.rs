use std::{cell::Ref, collections::HashMap, num::NonZeroU32, str::FromStr};

use ariadne::{Cache, Config, Fmt, FnCache, Label, Report, ReportKind, Source};
// use ariadne::{Report, ReportKind};
use fast_image_resize as fr;
use fr::Resizer;
use typst::{
    diag::{Severity, SourceDiagnostic},
    doc::Document,
    geom::{Color, RgbaColor},
    syntax::FileId,
};
use wasm_bindgen::Clamped;
use web_sys::{console, ImageData};

use crate::file_entry::FileEntry;

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

pub fn format_diagnostic(
    sources: Ref<HashMap<FileId, FileEntry>>,
    diagnostics: &[SourceDiagnostic],
) -> String {
    let config = Config::default().with_color(false).with_tab_width(2);
    let mut bytes = Vec::new();

    let mut cache = FnCache::new(|id: &_| Ok(sources.get(id).unwrap().source().text().to_string()));

    for diagnostic in diagnostics {
        let id = diagnostic.span.id();
        let source = sources.get(&id).unwrap().source();
        let range = source.range(diagnostic.span);
        let mut report = Report::build(
            match diagnostic.severity {
                Severity::Error => ReportKind::Error,
                Severity::Warning => ReportKind::Warning,
            },
            id,
            range.start,
        )
        .with_config(config)
        .with_message(&diagnostic.message)
        .with_label(Label::new((id, range)));
        if !diagnostic.hints.is_empty() {
            report.set_help(diagnostic.hints.join("\n"))
        }
        report.finish().write(&mut cache, &mut bytes).unwrap();

        bytes.push(b'\n');
        for point in &diagnostic.trace {
            let id = point.span.id();
            let source = sources.get(&id).unwrap().source();
            let range = source.range(point.span);

            Report::build(ReportKind::Advice, id, range.start)
                .with_config(config)
                .with_message(point.v.to_string())
                .with_label(Label::new((id, range)))
                .finish()
                .write(&mut cache, &mut bytes)
                .unwrap();
            bytes.push(b'\n');
        }
    }

    return String::from_utf8(bytes).unwrap().trim().to_string();
}
