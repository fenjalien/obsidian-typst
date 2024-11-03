use std::{collections::HashMap, ops::Range};

use ariadne::{Config, FnCache, Label, Report, ReportKind};
use typst::{
    diag::{Severity, SourceDiagnostic},
    syntax::{FileId, Span},
};

use crate::file_entry::FileEntry;

#[derive(Hash, PartialEq, Eq, Clone, Copy)]
struct Id(Option<FileId>);

impl std::fmt::Debug for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0.is_some() {
            write!(f, "{:?}", self.0.unwrap())
        } else {
            write!(f, "")
        }
    }
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.0.is_some() {
            write!(f, "{:?}", self.0.unwrap())
        } else {
            write!(f, "")
        }
    }
}

pub fn format_diagnostic(
    sources: &HashMap<FileId, FileEntry>,
    diagnostics: &[SourceDiagnostic],
) -> String {
    let mut bytes = Vec::new();

    let mut cache = FnCache::new(|id: &Id| {
        Ok(if let Some(id) = id.0 {
            sources.get(&id).unwrap().source().text().to_string()
        } else {
            String::new()
        })
    });

    for diagnostic in diagnostics {
        let mut report = build_report(
            diagnostic.span,
            match diagnostic.severity {
                Severity::Error => ReportKind::Error,
                Severity::Warning => ReportKind::Warning,
            },
            diagnostic.message.to_string(),
            sources,
        );

        if !diagnostic.hints.is_empty() {
            report.set_help(diagnostic.hints.join("\n"))
        }
        report.finish().write(&mut cache, &mut bytes).unwrap();

        bytes.push(b'\n');
        for point in &diagnostic.trace {
            build_report(point.span, ReportKind::Advice, point.v.to_string(), sources)
                .finish()
                .write(&mut cache, &mut bytes)
                .unwrap();

            bytes.push(b'\n');
        }
    }

    return String::from_utf8(bytes).unwrap().trim().to_string();
}

fn build_report<'a>(
    span: Span,
    report_kind: ReportKind<'a>,
    message: String,
    sources: &HashMap<FileId, FileEntry>,
) -> ariadne::ReportBuilder<'a, (Id, Range<usize>)> {
    let config = Config::default().with_color(false).with_tab_width(2);
    let id = Id(span.id());
    let range = if let Some(id) = id.0 {
        sources.get(&id).unwrap().source().range(span).unwrap()
    } else {
        0..0
    };

    Report::build(report_kind, (id, range.clone()))
        .with_config(config)
        .with_message(message)
        .with_label(Label::new((id, range)))
}
