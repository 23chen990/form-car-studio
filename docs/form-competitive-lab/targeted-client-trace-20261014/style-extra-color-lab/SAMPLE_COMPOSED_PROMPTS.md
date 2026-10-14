# FORM 研究型完整 Prompt 示例（均未生成图片）

由 `compose.mjs` 离线编译。研究开关仅用于此独立脚本演示，不是 Provider 能力或支出授权。

## Street + Widebody + Matte Black

Input: `{"source":{"kind":"original"},"styleId":"street","extraId":"widebody","colorId":"matte_black"}`  
Intent digest: `1fb453f54913fdb35ce88bcc3ab4b7bce0cfcec8af7797488f833a485c268faf`  
输出数：1  额外文字LLM调用：0

```text
SOURCE IMAGE ROLE: The attached primary image is the actual car to edit. Use this exact image as the identity and camera reference.

STYLE DIRECTION: A restrained, realistic street-tuning aesthetic with crisp, coherent exterior details.

ADDITIONAL MODIFICATION: Add subtle, coherent widened fender contours and wheel-arch extensions that follow the existing body lines; keep all changes confined to the visible fender and arch areas.

BODY PAINT: Repaint the visible painted exterior body surfaces matte black, with low-gloss surface response and physically plausible reflections.

ALLOW ONLY: fender contours; wheel arch extensions; and the explicitly requested body paint treatment.

PRESERVE: Keep the same recognizable vehicle identity, door count, roofline, windows, lights, wheelbase impression, visible badges and license plate layout. Keep the same camera angle, framing, background, scene illumination direction and ground contact shadows. Preserve original wheel centers, apparent outside wheel diameter, tire geometry and the visible steering side. Keep the original wheel centers, wheelbase, wheel count, tires and door/window openings. Do not add a spoiler, front lip, light bar or unrelated part. Do not recolor windows, tires, lights, exposed metal trim, interior or background.

OUTPUT: One photorealistic automotive concept of the same car. Keep the complete visible vehicle in frame. Edges, reflections and shadows must match the original photograph. No added people, new scenery, aftermarket brand badges, new text, watermarks or unrequested parts.

DISCLAIMER: Visual concept only; do not imply certified real-world fitment, materials or safety.
```

## Track + Rear Spoiler + Metallic Silver

Input: `{"source":{"kind":"original"},"styleId":"track","extraId":"spoiler","colorId":"metallic_silver"}`  
Intent digest: `27d14198519083782a8e884bb154302bec7e55e948356c0df9543a2633651ab0`  
输出数：1  额外文字LLM调用：0

```text
SOURCE IMAGE ROLE: The attached primary image is the actual car to edit. Use this exact image as the identity and camera reference.

STYLE DIRECTION: A restrained, track-inspired aesthetic with functional-looking but non-certified exterior details.

ADDITIONAL MODIFICATION: Add one subtle, visually plausible rear spoiler where the source camera angle and visible rear body make it possible. Do not fabricate hidden mounting details.

BODY PAINT: Repaint the visible painted exterior body surfaces metallic silver, with realistic fine metallic highlights matched to the source illumination.

ALLOW ONLY: visible rear spoiler; and the explicitly requested body paint treatment.

PRESERVE: Keep the same recognizable vehicle identity, door count, roofline, windows, lights, wheelbase impression, visible badges and license plate layout. Keep the same camera angle, framing, background, scene illumination direction and ground contact shadows. Preserve original wheel centers, apparent outside wheel diameter, tire geometry and the visible steering side. Preserve original fender widths, wheels, door/window openings and body proportions. Do not add a widebody kit, front lip, light bar or unrelated part. Do not recolor windows, tires, lights, exposed metal trim, interior or background.

OUTPUT: One photorealistic automotive concept of the same car. Keep the complete visible vehicle in frame. Edges, reflections and shadows must match the original photograph. No added people, new scenery, aftermarket brand badges, new text, watermarks or unrequested parts.

DISCLAIMER: Visual concept only; do not imply certified real-world fitment, materials or safety.
```

## Touring + Front Lip + Gloss Red (refine exact V2)

Input: `{"source":{"kind":"version","versionId":"v2"},"styleId":"touring","extraId":"front_lip","colorId":"gloss_red"}`  
Intent digest: `ea412e7d86fe6404f7fa928a0cc631eb09774e22ef9afbeb2a72b2e691cc596f`  
输出数：1  额外文字LLM调用：0

```text
SOURCE IMAGE ROLE: The attached primary image is the actual car to edit. Use this exact image as the identity and camera reference.

STYLE DIRECTION: A refined OEM-plus touring aesthetic with premium, subtle exterior refinement.

ADDITIONAL MODIFICATION: Add one subtle, visually coherent lower front-lip extension only on visible front bumper geometry. Respect the perspective of the source photo.

BODY PAINT: Repaint the visible painted exterior body surfaces gloss deep red, with coherent glossy reflections that follow the source lighting.

ALLOW ONLY: visible lower front lip; and the explicitly requested body paint treatment.

PRESERVE: Keep the same recognizable vehicle identity, door count, roofline, windows, lights, wheelbase impression, visible badges and license plate layout. Keep the same camera angle, framing, background, scene illumination direction and ground contact shadows. Preserve original wheel centers, apparent outside wheel diameter, tire geometry and the visible steering side. Preserve the original fender widths, wheels, doors, windows and roofline. Do not add a widebody kit, rear spoiler, light bar or unrelated part. Do not recolor windows, tires, lights, exposed metal trim, interior or background.

OUTPUT: One photorealistic automotive concept of the same car. Keep the complete visible vehicle in frame. Edges, reflections and shadows must match the original photograph. No added people, new scenery, aftermarket brand badges, new text, watermarks or unrequested parts.

DISCLAIMER: Visual concept only; do not imply certified real-world fitment, materials or safety.
```

