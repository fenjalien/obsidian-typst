export default class TypstRenderElement extends HTMLElement {
    static compile: (path: string, source: string, size: number, display: boolean, fontSize: number) => Promise<ImageData | string>;
    static nextId = 0;
    static prevHeight = 0;

    // The Element's Id
    id: string
    // The number in the element's id.
    num: string

    abortController: AbortController
    format: string
    source: string
    path: string
    display: boolean
    resizeObserver: ResizeObserver
    size: number
    math: boolean

    canvas: HTMLCanvasElement

    async connectedCallback() {
        if (!this.isConnected) {
            console.warn("Typst Renderer: Canvas element has been called before connection");
            return;
        }

        if (this.format == "image" && this.canvas == undefined) {
            this.canvas = this.appendChild(createEl("canvas", { attr: { height: TypstRenderElement.prevHeight }, cls: "typst-doc" }))
        }

        this.num = TypstRenderElement.nextId.toString()
        TypstRenderElement.nextId += 1
        this.id = "TypstRenderElement-" + this.num
        this.abortController = new AbortController()

        if (this.display) {
            this.style.display = "block"
            this.resizeObserver = new ResizeObserver((entries) => {
                if (entries[0]?.contentBoxSize[0].inlineSize !== this.size) {
                    this.draw()
                }
            })
            this.resizeObserver.observe(this)
        }
        await this.draw()
    }

    disconnectedCallback() {
        if (this.format == "image") {
            TypstRenderElement.prevHeight = this.canvas.height
        }
        if (this.display && this.resizeObserver != undefined) {
            this.resizeObserver.disconnect()
        }
    }

    async draw() {
        this.abortController.abort()
        this.abortController = new AbortController()
        try {
            await navigator.locks.request(this.id, { signal: this.abortController.signal }, async () => {
                let fontSize = parseFloat(getComputedStyle(this).fontSize)
                this.size = this.display ? this.clientWidth : parseFloat(getComputedStyle(this).lineHeight)

                // resizeObserver can trigger before the element gets disconnected which can cause the size to be 0
                // which causes a NaN. size can also sometimes be -ve so wait for resize to draw it again
                if (!(this.size > 0)) {
                    return;
                }

                try {
                    let result = await TypstRenderElement.compile(this.path, this.source, this.size, this.display, fontSize)
                    if (result instanceof ImageData && this.format == "image") {
                        this.drawToCanvas(result)
                    } else if (typeof result == "string" && this.format == "svg") {
                        this.innerHTML = result;
                        let child = (this.firstElementChild as SVGElement);
                        child.setAttribute("width", child.getAttribute("width")!.replace("pt", ""))
                        child.setAttribute("height", child.getAttribute("height")!.replace("pt", ""))
                        child.setAttribute("width", `${this.firstElementChild!.clientWidth /fontSize}em`);
                        child.setAttribute("height", `${this.firstElementChild!.clientHeight /fontSize}em`);
                    }
                } catch (error) {
                    // For some reason it is uncaught so remove "Uncaught "
                    error = error.slice(9)
                    let pre = createEl("pre", {
                        attr: {
                            style: "white-space: pre;"
                        }
                    })//"<pre> </pre>"
                    pre.textContent = error
                    this.outerHTML = pre.outerHTML
                    return
                }


            })

        } catch (error) {
            return
        }
    }

    drawToCanvas(image: ImageData) {
        let ctx = this.canvas.getContext("2d")!;
        // if (this.display) {
        //     this.style.width = "100%"
        //     this.style.height = ""
        // } else {
        //     this.style.verticalAlign = "bottom"
        //     this.style.height = `${this.size}px`
        // }
        this.canvas.width = image.width
        this.canvas.height = image.height

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.putImageData(image, 0, 0);
    }
}
