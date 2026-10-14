import { classifyOutput, type Decision } from '../../shared/v2/form-quality-policy.js';
import type { ImageAsset } from './images.js';

/** Classifies only server-normalized images; a user report is never an image assessment. */
export function assessImageOutput(source: ImageAsset, output: ImageAsset, requestedEdits: number): Decision {
  return classifyOutput({
    requestedEdits,
    decode: 'valid',
    sourcePixels: { normalizerVersion: source.normalizerVersion, sha256: source.pixelSha256, width: source.width, height: source.height },
    outputPixels: { normalizerVersion: output.normalizerVersion, sha256: output.pixelSha256, width: output.width, height: output.height },
  });
}
