/**
 * FRIDAY's model plan (client-safe). Friday's brain turns a request into this
 * structured plan; Friday's own Blender script (scripts/friday/build.py) turns
 * the plan into real geometry. The brain never writes code that runs inside
 * Blender — only this data, which is validated here first.
 *
 * Units are millimetres. Verified specifications are kept apart from
 * assumptions, and components the brief doesn't establish are marked conceptual.
 */
import { z } from "zod";

const num = (min: number, max: number) => z.coerce.number().finite().min(min).max(max);
const vec3 = z.tuple([num(-5000, 5000), num(-5000, 5000), num(-5000, 5000)]);
const id = z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/i, "letters, digits and _ only");
const hex = z.string().trim().regex(/^#[0-9a-f]{6}$/i, "a #rrggbb colour");

export const materialSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  color: hex,
  metallic: num(0, 1).default(0),
  roughness: num(0, 1).default(0.5),
  /** 0 = opaque, 1 = clear glass/plastic */
  transmission: num(0, 1).default(0),
  ior: num(1, 3).default(1.45),
  /** 0..1 — 1 = fully opaque */
  alpha: num(0, 1).default(1),
  emission: hex.optional(),
  emissionStrength: num(0, 50).default(0),
});

export const shapeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("box"), size: vec3 }),
  z.object({ type: z.literal("rounded_rect"), width: num(0.1, 5000), height: num(0.1, 5000), depth: num(0.05, 5000), radius: num(0, 2500).default(0) }),
  z.object({ type: z.literal("cylinder"), radius: num(0.05, 2500), depth: num(0.05, 5000), vertices: z.coerce.number().int().min(6).max(128).default(48) }),
  z.object({ type: z.literal("cone"), radius1: num(0, 2500), radius2: num(0, 2500), depth: num(0.05, 5000) }),
  z.object({ type: z.literal("sphere"), radius: num(0.05, 2500) }),
  z.object({ type: z.literal("torus"), major: num(0.1, 2500), minor: num(0.05, 1000) }),
  z.object({ type: z.literal("capsule"), radius: num(0.05, 2500), length: num(0.05, 5000) }),
  /** a 2D outline (XY, mm) extruded along Z by depth — frames, plates, lens shapes, brackets */
  z.object({ type: z.literal("profile"), points: z.array(z.tuple([num(-5000, 5000), num(-5000, 5000)])).min(3).max(200), depth: num(0.05, 5000) }),
  /** a round tube swept along a path (mm) — arms, cables, rails, handles */
  z.object({ type: z.literal("tube"), points: z.array(vec3).min(2).max(100), radius: num(0.05, 500) }),
]);
export type Shape = z.infer<typeof shapeSchema>;

export const componentSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  /** the collection it belongs to, e.g. "Main Frame", "Electronics" */
  group: z.string().trim().min(1).max(40).default("Model"),
  material: id,
  shape: shapeSchema,
  position: vec3.default([0, 0, 0]),
  /** degrees, XYZ */
  rotation: vec3.default([0, 0, 0]),
  scale: z.tuple([num(0.01, 100), num(0.01, 100), num(0.01, 100)]).default([1, 1, 1]),
  bevel: z.object({ width: num(0, 200), segments: z.coerce.number().int().min(1).max(12).default(3) }).optional(),
  /** shell thickness (mm) — hollow parts */
  solidify: num(0.05, 200).optional(),
  /** smooth subdivision level */
  subdivision: z.coerce.number().int().min(0).max(3).default(0),
  /** mirror across X (left/right symmetric parts) */
  mirrorX: z.boolean().default(false),
  /** ids of cutter components subtracted from this one */
  subtract: z.array(id).max(8).default([]),
  /** only used to cut other parts; never shown */
  cutter: z.boolean().default(false),
  /** inside the product (shown in exploded / internal views) */
  internal: z.boolean().default(false),
  /** not established by the specifications — a labelled placeholder */
  conceptual: z.boolean().default(false),
  /** where it moves in the exploded view (mm offset) */
  explode: vec3.optional(),
});
export type Component = z.infer<typeof componentSchema>;

export const planSchema = z.object({
  name: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(600).default(""),
  specs: z.object({
    verified: z.array(z.string().trim().max(300)).max(40).default([]),
    assumptions: z.array(z.string().trim().max(300)).max(40).default([]),
    questions: z.array(z.string().trim().max(300)).max(10).default([]),
  }).default({}),
  materials: z.array(materialSchema).min(1).max(30),
  components: z.array(componentSchema).min(1).max(120),
  /** the component the close-up view focuses on */
  detail: id.optional(),
  environment: z.enum(["studio_dark", "studio_light", "white"]).default("studio_dark"),
}).superRefine((p, ctx) => {
  const mats = new Set(p.materials.map((m) => m.id));
  const ids = new Set<string>();
  p.components.forEach((c, i) => {
    if (ids.has(c.id)) ctx.addIssue({ code: "custom", path: ["components", i, "id"], message: `duplicate component id "${c.id}"` });
    ids.add(c.id);
    if (!mats.has(c.material)) ctx.addIssue({ code: "custom", path: ["components", i, "material"], message: `unknown material "${c.material}"` });
  });
  p.components.forEach((c, i) => c.subtract.forEach((s) => {
    const cut = p.components.find((x) => x.id === s);
    if (!cut) ctx.addIssue({ code: "custom", path: ["components", i, "subtract"], message: `unknown cutter "${s}"` });
    else if (!cut.cutter) ctx.addIssue({ code: "custom", path: ["components", i, "subtract"], message: `"${s}" must have cutter: true` });
  }));
  if (!p.components.some((c) => !c.cutter)) ctx.addIssue({ code: "custom", path: ["components"], message: "nothing visible to build" });
  if (p.detail && !ids.has(p.detail)) ctx.addIssue({ code: "custom", path: ["detail"], message: `unknown component "${p.detail}"` });
});
export type Plan = z.infer<typeof planSchema>;

/** The ten default views (the last one is the exploded / internal view). */
export const VIEWS = [
  { id: "front", label: "Front", kind: "ortho" },
  { id: "rear", label: "Rear", kind: "ortho" },
  { id: "left", label: "Left side", kind: "ortho" },
  { id: "right", label: "Right side", kind: "ortho" },
  { id: "top", label: "Top", kind: "ortho" },
  { id: "bottom", label: "Bottom", kind: "ortho" },
  { id: "front_34", label: "Front three-quarter", kind: "persp" },
  { id: "rear_34", label: "Rear three-quarter", kind: "persp" },
  { id: "detail", label: "Detail close-up", kind: "persp" },
  { id: "exploded", label: "Exploded view", kind: "persp" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];
export const VIEW_IDS = VIEWS.map((v) => v.id) as ViewId[];

/** Whether the exploded view means anything for this plan (otherwise a hero angle replaces it). */
export const hasExplodedParts = (p: Plan) => p.components.filter((c) => !c.cutter).length >= 3 && (p.components.some((c) => c.explode) || p.components.some((c) => c.internal));
