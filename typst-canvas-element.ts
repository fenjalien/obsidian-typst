export default class TypstCanvasElement extends HTMLCanvasElement {
    static compile: (source: string, size: number, display: boolean, fontSize: number) => ImageData;

    source: string
    display: boolean
    resizeObserver: ResizeObserver
    size: number

    connectedCallback() {
        if (!this.isConnected) {
            console.log("called before connection");
            return;
        }
        this.draw()
        if (this.display) {
            this.resizeObserver = new ResizeObserver((entries) => {
                if (entries[0]?.contentBoxSize[0].inlineSize !== this.size) {
                    this.draw()
                }
            })
            this.resizeObserver.observe(this.parentElement!.parentElement!)
        }
    }

    disconnectedCallback() {
        if (this.display) {
            this.resizeObserver.disconnect()
        }
    }

    draw() {

        let fontSize = parseFloat(this.getCssPropertyValue("--font-text-size"))
        this.size = this.display ? this.parentElement!.parentElement!.innerWidth : parseFloat(this.getCssPropertyValue("--line-height-normal")) * fontSize
        // console.log(size, this.parentElement);


        if (this.display) {
            this.style.width = "100%"
        } else {
            this.style.verticalAlign = "bottom"
            this.style.height = `${this.size}px`
        }

        let image: ImageData;
        let ctx = this.getContext("2d")!;
        try {
            image = TypstCanvasElement.compile(this.source, this.size, this.display, fontSize)
        } catch (error) {
            console.error(error);
            this.outerText = error
            return
        }

        this.width = image.width
        this.height = image.height

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.putImageData(image, 0, 0);
    }
}