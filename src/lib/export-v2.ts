export interface ContainedRect { x: number; y: number; width: number; height: number }
export const MAX_EXPORT_PIXELS = 40_000_000;
export const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
export interface OwnedAssetIdentity { ownerId: string; projectId: string; assetId: string }
export interface OwnedAssetBlob extends OwnedAssetIdentity { bytes: Blob }
export type GarageExportKind = 'clean' | 'comparison' | 'recipe';
export interface GarageCanvasContext {
  fillStyle: string; font: string; textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: object, x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}
export interface GarageDecodedImage {
  width: number; height: number;
  draw(context: GarageCanvasContext, x: number, y: number, width: number, height: number): void;
  close(): void;
}
export interface GarageExportRuntime {
  decode(blob: Blob): Promise<GarageDecodedImage>;
  canvas(width: number, height: number): { width: number; height: number; context: GarageCanvasContext; toBlob(): Promise<Blob> };
}
export interface GarageExportInput {
  kind: GarageExportKind; ownerId: string; projectId: string; versionId: string; assetId: string; asset: OwnedAssetBlob;
  comparison?: { versionId: string; assetId: string; asset: OwnedAssetBlob }; recipe?: readonly string[];
}
export interface GarageExportFile { kind: GarageExportKind; versionId: string; blob: Blob; width: number; height: number; filename: string }

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function validateOwnedAssetBlob(value: unknown, expected: OwnedAssetIdentity): Blob {
  if (!plain(value) || Reflect.ownKeys(value).length !== 4 || !Object.hasOwn(value, 'ownerId') || !Object.hasOwn(value, 'projectId') ||
    !Object.hasOwn(value, 'assetId') || !Object.hasOwn(value, 'bytes') || value.ownerId !== expected.ownerId ||
    value.projectId !== expected.projectId || value.assetId !== expected.assetId || !(value.bytes instanceof Blob) ||
    value.bytes.size < 1 || value.bytes.size > MAX_EXPORT_BYTES || !['image/png', 'image/jpeg'].includes(value.bytes.type.toLowerCase())) {
    throw new TypeError('Owned export asset is unavailable or outside the image bounds.');
  }
  return value.bytes;
}

export function assertExportDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_EXPORT_PIXELS) {
    throw new TypeError('Decoded image dimensions exceed the export bounds.');
  }
}

export function fitContainedRect(sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number): ContainedRect {
  if (![sourceWidth, sourceHeight, frameWidth, frameHeight].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Image and frame dimensions must be positive safe integers.');
  }
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

const browserRuntime: GarageExportRuntime = {
  decode: async blob => {
    if (typeof createImageBitmap !== 'function') throw new Error('Image decoding is unavailable.');
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height,
      draw: (context, x, y, width, height) => context.drawImage(bitmap, x, y, width, height), close: () => bitmap.close() };
  },
  canvas: (width, height) => {
    const element = document.createElement('canvas'); element.width = width; element.height = height;
    const context = element.getContext('2d');
    if (!context) throw new Error('Image export is unavailable.');
    return { width: element.width, height: element.height, context: context as unknown as GarageCanvasContext,
      toBlob: () => new Promise<Blob>((resolve, reject) => element.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed.')), 'image/png')) };
  },
};

function boundedText(value: string): string { return value.length > 96 ? `${value.slice(0, 95)}…` : value; }
function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'version'; }

export async function createGarageExport(input: GarageExportInput, runtime: GarageExportRuntime = browserRuntime): Promise<GarageExportFile> {
  const current = validateOwnedAssetBlob(input.asset, { ownerId: input.ownerId, projectId: input.projectId, assetId: input.assetId });
  if (input.kind === 'comparison' && (!input.comparison || input.comparison.versionId === input.versionId)) throw new Error('Choose another version in this project to compare.');
  if (input.kind !== 'comparison' && input.comparison) throw new Error('Unexpected comparison asset.');
  if (input.comparison) validateOwnedAssetBlob(input.comparison.asset, { ownerId: input.ownerId, projectId: input.projectId, assetId: input.comparison.assetId });
  const images: GarageDecodedImage[] = [];
  try {
    const image = await runtime.decode(current); images.push(image); assertExportDimensions(image.width, image.height);
    let other: GarageDecodedImage | undefined;
    if (input.kind === 'comparison' && input.comparison) {
      other = await runtime.decode(input.comparison.asset.bytes); images.push(other); assertExportDimensions(other.width, other.height);
    }
    const width = input.kind === 'comparison' ? 2 * Math.max(image.width, other!.width) : input.kind === 'recipe' ? 1080 : image.width;
    const height = input.kind === 'comparison' ? Math.max(image.height, other!.height) : input.kind === 'recipe' ? 1350 : image.height;
    assertExportDimensions(width, height);
    const canvas = runtime.canvas(width, height), context = canvas.context;
    context.fillStyle = '#f7f7f2'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (input.kind === 'clean') {
      const rect = fitContainedRect(image.width, image.height, canvas.width, canvas.height);
      image.draw(context, rect.x, rect.y, rect.width, rect.height);
    } else if (input.kind === 'comparison') {
      const panelWidth = canvas.width / 2;
      for (const [source, offset] of [[image, 0], [other!, panelWidth]] as const) {
        const rect = fitContainedRect(source.width, source.height, panelWidth, canvas.height);
        source.draw(context, offset + rect.x, rect.y, rect.width, rect.height);
      }
    } else {
      context.fillStyle = '#22271f'; context.font = '600 30px sans-serif'; context.textBaseline = 'top';
      context.fillText('FORM · RECIPE STUDY', 72, 52, 936);
      context.font = '18px sans-serif'; context.fillText('Requested recipe · not verified image facts', 72, 94, 936);
      const rect = fitContainedRect(image.width, image.height, 936, 830);
      image.draw(context, 72 + rect.x, 140 + rect.y, rect.width, rect.height);
      context.font = '600 20px sans-serif'; context.fillText('Requested recipe', 72, 1010, 936);
      context.font = '18px sans-serif';
      (input.recipe ?? []).slice(0, 8).forEach((line, index) => context.fillText(`• ${boundedText(line)}`, 82, 1050 + index * 34, 916));
    }
    const blob = await canvas.toBlob();
    if (blob.type !== 'image/png' || blob.size < 1 || blob.size > MAX_EXPORT_BYTES) throw new Error('The exported image is not a supported bounded PNG.');
    return { kind: input.kind, versionId: input.versionId, blob, width: canvas.width, height: canvas.height,
      filename: `form-${input.kind}-${safeName(input.versionId)}.png` };
  } finally { images.forEach(image => image.close()); }
}
