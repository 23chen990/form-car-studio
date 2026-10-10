import sharp from "sharp";
import { renderDemo } from "../server/demo";
import { STYLES, styleTarget } from "../shared/catalog";
for (const style of STYLES) {
  const target = styleTarget(style.id);
  await sharp(await renderDemo(target, style.id))
    .jpeg({ quality: 88 })
    .toFile(`public/images/${style.id}.jpg`);
}
console.log("Eight demo color studies created from the supplied sample.");
