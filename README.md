# Typst Renderer

Renders `typst` code blocks, and optionally math blocks, into images using [Typst](https://github.com/typst/typst) through the power of WASM! This is still very much in development, so suggestions and bugs are welcome!

## Things to NOTE
- Typst does not currently support exporting to HTML only PDFs and PNGs. So due to image scaling, the rendered views may look a bit terrible. If you know how to fix this PLEASE HELP.
- File paths should be relative to the vault folder.
- System fonts are not loaded by default as this takes about 20 seconds (on my machine). There is an option in settings to enable them (requires a reload of the plugin).

## Math Block Usage
The plugin can render `typst` inside math blocks! By default this is off, to enable it set the "Override Math Blocks" setting or use the "Toggle Math Block Override" command. Math block types are conserved between Obsidian and Typst, `$...$` -> `$...$` and `$$...$$` -> `$ ... $`.

From what I've experimented with, normal math blocks are okay with `typst` code but Typst is not happy with any Latex code.

For styling and using imports with math blocks see the next section.

## Preamables
Need to style your `typst` code the same way everytime and don't to write it out each time? Or using math blocks and need a way to import things? Use PREAMABLES! 

Preamables are prepended to your `typst` code before compiling. There are three different types in settings:
- `shared`: Prepended to all `typst` code.
- `math`: Prepended to `typst` code only in math blocks.
- `code`: Prepended to `typst` code only in code blocks.

## Known Issues
### "File Not Found" Error on First Load of Obsidian
When Obsidian first loads it sometimes tries to render before its files are resolved and cached. 

To fix, simply select then deselect everything in the file, or close and re-open the file.

## Example

```
```typst
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
Until this plugin is submitted to the community plugins please install it by copying `main.js`, `styles.css`, and `manifest.json` from the releases tab to the folder `.obsidian/plugins/obsidian-typst` in your vault.

## TODO / Goals (In no particular order)
- [x] Better font loading
- [x] Fix importing
- [x] Fix Github Actions
- [ ] Better error handling
- [ ] Fix output image scaling
- [ ] Use HTML output
- [x] Override default equation rendering
- [ ] Custom editor for `.typ` files
