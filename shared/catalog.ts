import type { StyleDefinition, StyleId, Target } from "./types";

export interface ColorOption {
  id: string;
  label: string;
  hex: string;
}

export const STYLES: readonly StyleDefinition[] = [
  {
    id: "sport",
    name: "Street Sport",
    shortName: "Sport",
    category: "Sporty",
    description: "A little attitude. A lot of everyday appeal.",
    details: [
      "Deep blue paint",
      "Warm bronze wheels",
      "Sport-inspired details",
    ],
    imageUrl: "/images/sport.jpg",
    sampleBodyColor: "blue",
    sampleWheelColor: "bronze",
    prompt:
      "A cohesive street-sport look: deep blue paint, bronze sport wheels, a restrained lower stance and subtle front lip. Keep the original vehicle identity and avoid extreme racing equipment.",
  },
  {
    id: "clean",
    name: "Clean Upgrade",
    shortName: "Clean",
    category: "Subtle",
    description: "The car you love, with the details dialed in.",
    details: [
      "Keep original paint",
      "Bright silver wheels",
      "Understated finish",
    ],
    imageUrl: "/images/clean.jpg",
    sampleBodyColor: "keep",
    sampleWheelColor: "silver",
    prompt:
      "An understated OEM-plus refresh. Preserve the original body paint exactly, with clean silver wheels and very subtle trim refinements. Keep the familiar character and factory silhouette.",
  },
  {
    id: "dark",
    name: "Dark & Refined",
    shortName: "Dark",
    category: "Expressive",
    description: "Quiet confidence, from every angle.",
    details: ["Graphite paint", "Dark wheels", "Tonal contrast"],
    imageUrl: "/images/dark.jpg",
    sampleBodyColor: "graphite",
    sampleWheelColor: "graphite",
    prompt:
      "A dark refined palette of graphite paint, graphite wheels and coordinated dark trim. Retain readable panel contours, reflections and realistic shadows.",
  },
  {
    id: "heritage",
    name: "Modern Classic",
    shortName: "Classic",
    category: "Expressive",
    description: "Old-school soul. A fresh perspective.",
    details: ["Forest green paint", "Bright silver wheels", "Heritage palette"],
    imageUrl: "/images/heritage.jpg",
    sampleBodyColor: "green",
    sampleWheelColor: "silver",
    prompt:
      "A modern-classic look using forest green paint and bright silver wheels with tasteful heritage-inspired detailing. Preserve this exact car and avoid changing it into an older model.",
  },
  {
    id: "track",
    name: "Track Inspired",
    shortName: "Track",
    category: "Sporty",
    description: "Focused contrast, inspired by the pit lane.",
    details: ["Silver paint", "Graphite wheels", "Purposeful accents"],
    imageUrl: "/images/track.jpg",
    sampleBodyColor: "silver",
    sampleWheelColor: "graphite",
    prompt:
      "A road-car look inspired by track days: cool silver paint, graphite lightweight-style wheels and modest aerodynamic accents. No racing decals, giant wing or identity changes.",
  },
  {
    id: "rally",
    name: "Retro Rally",
    shortName: "Rally",
    category: "Sporty",
    description: "Adventure in the details. Nostalgia in the palette.",
    details: ["Forest green paint", "Bronze wheels", "Rally-inspired attitude"],
    imageUrl: "/images/rally.jpg",
    sampleBodyColor: "green",
    sampleWheelColor: "bronze",
    prompt:
      "A tasteful retro-rally road-car concept with forest green paint, warm bronze wheels and subtle rally-inspired details. Preserve the original body proportions, no extreme lift or racing livery.",
  },
  {
    id: "touring",
    name: "Grand Touring",
    shortName: "Touring",
    category: "Subtle",
    description: "Composed, polished, ready for the long way home.",
    details: ["Silver paint", "Bronze wheels", "Refined contrast"],
    imageUrl: "/images/touring.jpg",
    sampleBodyColor: "silver",
    sampleWheelColor: "bronze",
    prompt:
      "A composed grand-touring treatment: silver paint, refined bronze wheels and discreet polished trim. Emphasize elegance rather than aggressive spoilers.",
  },
  {
    id: "color",
    name: "Color Forward",
    shortName: "Color",
    category: "Expressive",
    description: "A bold color story that still feels like you.",
    details: ["Ruby paint", "Silver wheels", "Bold color contrast"],
    imageUrl: "/images/color.jpg",
    sampleBodyColor: "red",
    sampleWheelColor: "silver",
    prompt:
      "A bold but cohesive color-led concept: deep ruby red paint, cool silver wheels and minimal supporting trim changes. Keep all original vehicle geometry and scene.",
  },
];

export const STYLE_BY_ID: Readonly<Record<StyleId, StyleDefinition>> =
  Object.fromEntries(STYLES.map((style) => [style.id, style])) as Record<
    StyleId,
    StyleDefinition
  >;

export const BODY_COLORS: readonly ColorOption[] = [
  { id: "keep", label: "Keep current", hex: "transparent" },
  { id: "blue", label: "Deep blue", hex: "#234974" },
  { id: "silver", label: "Cool silver", hex: "#bec3c7" },
  { id: "green", label: "Forest green", hex: "#2c5145" },
  { id: "graphite", label: "Graphite", hex: "#33383D" },
];

export const WHEEL_COLORS: readonly ColorOption[] = [
  { id: "keep", label: "Keep current", hex: "transparent" },
  { id: "silver", label: "Cool silver", hex: "#bec3c7" },
  { id: "graphite", label: "Graphite", hex: "#33383D" },
  { id: "bronze", label: "Warm bronze", hex: "#a08658" },
];

export function styleTarget(styleId: StyleId): {
  bodyColor: string;
  wheelColor: string;
} {
  const style = STYLE_BY_ID[styleId];
  return {
    bodyColor: style.sampleBodyColor,
    wheelColor: style.sampleWheelColor,
  };
}

export function styleName(styleId: StyleId): string {
  return STYLE_BY_ID[styleId]?.name ?? styleId;
}
export const KEEP_TARGET: Target = { bodyColor: "keep", wheelColor: "keep" };
export function colorName(value: string): string {
  return (
    [...BODY_COLORS, ...WHEEL_COLORS].find((color) => color.id === value)
      ?.label ??
    (value === "red" ? "Ruby red" : value === "black" ? "Graphite" : value)
  );
}
