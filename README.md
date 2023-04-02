# Obsidian Typst

Renders `typst` code blocks into images using [Typst](https://github.com/typst/typst) through the power of WASM! This is still very much in development, so suggestions/bugs are welcome!

**NOTE**: The plugin has to load fonts at startup, which on my machine takes about 20s but after that its *heckin* fast.
## Example

```
```typst
#set page(width: 10cm, height: auto)
#set heading(numbering: "1.")
#set text(white)

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
- [ ] Better font loading
- [ ] Fix Github Actions
- [ ] Fix output image scaling
- [ ] Use HTML output
- [ ] Override default equation rendering
- [ ] Custom editor for `.typ` files
