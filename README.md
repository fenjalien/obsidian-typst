# Obsidian Typst

Renders `typst` code blocks into images using [Typst](https://github.com/typst/typst) through the power of WASM! This is still very much in development, so suggestions/bugs are welcome!

## Things to NOTE
- Typst does not currently support exporting to HTML only PDFs and PNGs. So due to image scaling, the rendered views may look a bit terrible. If you know how to fix this PLEASE HELP.
- File paths should be relative to the vault folder.
- System fonts are not loaded by default as this takes about 20 seconds (on my machine). Their is an option in settings to enable them (requires a reload of the plugin).
## Example

### `conf.typ`
```typst
#let styling(ct) = {
    set page(width: 525pt, height: auto, margin: (x: 0pt, y: 1pt))
    set heading(numbering: "1.")
    set text(white)
    ct
}
```
### `Typst.md`
```
```typst
#import "conf.typ": styling
#show: styling

= Fibonacci sequence
The Fibonacci sequence is defined through the
_recurrence relation_ $F_n = F_(n-1) + F_(n-2)$.
It can also be expressed in closed form:

$ F_n = floor(1 / sqrt(5) phi.alt^n), quad
  phi.alt = (1 + sqrt(5)) / 2 $

#let count = 10
#let nums = range(1, count + 1)
#let fib(n) = (
  if n <= 2 { 1 }
  else { fib(n - 1) + fib(n - 2) }
)

The first #count numbers of the sequence are:

#align(center, table(
  columns: count,
  ..nums.map(n => $F_#n$),
  ..nums.map(n => str(fib(n))),
))

```​
```

<img src="assets/example.png">

## Installation
Until this plugin is submitted to the community plugins please install it by copying `main.js`, `styles.css`, and `manifest.json` from the releases tab to the folder `.obsidian/plugins/obsidian-typst`.

## TODO / Goals (In no particular order)
- [x] Better font loading
- [x] Fix importing
- [ ] Fix Github Actions
- [ ] Better error handling
- [ ] Fix output image scaling
- [ ] Use HTML output
- [ ] Override default equation rendering
- [ ] Custom editor for `.typ` files
