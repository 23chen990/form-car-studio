export type ExportKind = "image" | "wallpaper" | "comparison";

export interface ExportLayout {
  width: number;
  height: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
}

export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): ExportLayout {
  if (
    !(sourceWidth > 0) ||
    !(sourceHeight > 0) ||
    !(canvasWidth > 0) ||
    !(canvasHeight > 0)
  ) {
    throw new Error("Export dimensions must be positive");
  }
  const scale = Math.min(
    canvasWidth / sourceWidth,
    canvasHeight / sourceHeight,
  );
  const imageWidth = sourceWidth * scale;
  const imageHeight = sourceHeight * scale;
  return {
    width: canvasWidth,
    height: canvasHeight,
    imageX: (canvasWidth - imageWidth) / 2,
    imageY: (canvasHeight - imageHeight) / 2,
    imageWidth,
    imageHeight,
  };
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "form-look"
  );
}

/** Download an existing image without invoking generation. Browser-only by design. */
export async function exportLook(options: {
  kind: ExportKind;
  imageUrl: string;
  originalUrl?: string;
  filename?: string;
}): Promise<void> {
  if (typeof document === "undefined" || typeof window === "undefined")
    throw new Error("Image export requires a browser");
  const image = await loadImage(options.imageUrl);
  const canvas = document.createElement("canvas");
  const width =
    options.kind === "wallpaper"
      ? 1080
      : options.kind === "comparison"
        ? image.naturalWidth * 2
        : image.naturalWidth;
  const height = options.kind === "wallpaper" ? 1920 : image.naturalHeight;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = "#f2f0eb";
  context.fillRect(0, 0, width, height);
  if (options.kind === "comparison" && options.originalUrl) {
    const original = await loadImage(options.originalUrl);
    drawContain(context, original, { width: width / 2, height });
    drawContain(context, image, { width: width / 2, height }, width / 2);
    context.font = `${Math.max(18, Math.round(width / 90))}px sans-serif`;
    context.fillStyle = "#f7f7f2";
    context.fillRect(20, 20, 120, 45);
    context.fillRect(width / 2 + 20, 20, 120, 45);
    context.fillStyle = "#22271f";
    context.fillText("BEFORE", 35, 51);
    context.fillText("AFTER", width / 2 + 35, 51);
  } else drawContain(context, image, { width, height });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blobValue) =>
        blobValue
          ? resolve(blobValue)
          : reject(new Error("Could not create image")),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilename(options.filename ?? options.kind)}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawContain(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: { width: number; height: number },
  offsetX = 0,
): void {
  const layout = fitContain(
    image.naturalWidth,
    image.naturalHeight,
    frame.width,
    frame.height,
  );
  context.drawImage(
    image,
    offsetX + layout.imageX,
    layout.imageY,
    layout.imageWidth,
    layout.imageHeight,
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = url;
  });
}
