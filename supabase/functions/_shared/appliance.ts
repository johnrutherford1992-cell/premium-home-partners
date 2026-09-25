// lookup-appliance logic that doesn't touch the network: model normalization,
// the plate-reading prompt and JSON schema, and validation of the model's reply.
// Runtime-neutral so it is unit-tested under `node --test`.

import { TASKS } from './pricing.ts';

/** Task keys a plate reading may propose (packages/pricing TASKS). */
export const TASK_KEYS = ['hvac', 'fridge', 'ice', 'dish', 'wh', 'dryer', 'smoke'] as const;
export type TaskKey = (typeof TASK_KEYS)[number];
export const isTaskKey = (v: unknown): v is TaskKey => typeof v === 'string' && (TASK_KEYS as readonly string[]).includes(v);

export const CATEGORIES = ['hvac', 'refrigerator', 'dishwasher', 'water_heater', 'dryer', 'washer', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const MIN_INTERVAL_MONTHS = 1;
export const MAX_INTERVAL_MONTHS = 24;

/** Supported image types for plate photos (Claude vision input). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
/** Base64 characters, roughly a 5 MB image. */
export const MAX_IMAGE_BASE64 = 7_000_000;

export const LOOKUP_MSG = {
  noKey: 'Plate reading is not configured.',
  unreadable: "We couldn't read that plate. Try again or enter it manually.",
  notFound: "We don't have that model on file yet. Scan the plate, or keep it as entered.",
  missing: 'Enter a model number or take a photo of the plate.',
  badImage: "That photo didn't come through. Try again.",
  tooLarge: 'That photo is too large. Try a smaller one.',
} as const;

// Hyphen-minus plus the Unicode hyphens and dashes (U+2010..U+2015, U+2212).
const SEPARATORS = /[\s\-\u2010-\u2015\u2212]+/g;

/** Comparison key for model numbers: uppercase, no spaces or dashes. */
export function normModel(model: unknown): string {
  return typeof model === 'string' ? model.toUpperCase().replace(SEPARATORS, '') : '';
}

/** Display form: trimmed, uppercase, single spaces. */
export function cleanModel(model: unknown): string {
  return typeof model === 'string' ? model.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 40) : '';
}

/**
 * An ILIKE pattern that matches every stored spelling of `norm` (any spaces or
 * dashes between characters). It can over-match; confirm with normModel().
 */
export function modelLikePattern(norm: string): string {
  return norm
    .split('')
    .map((ch) => (ch === '%' || ch === '_' || ch === '\\' ? '\\' + ch : ch))
    .join('%');
}

/** Picks the cached model whose normalized number equals `norm`. */
export function pickCachedModel<T extends { model: string | null }>(rows: T[] | null | undefined, norm: string): T | null {
  if (!norm) return null;
  return (rows ?? []).find((r) => normModel(r.model) === norm) ?? null;
}

export interface ApplianceOut {
  brand: string | null;
  name: string | null;
  model: string;
  serial: string | null;
  category: string | null;
  note: string | null;
  model_id: string | null;
}

export interface TaskOut {
  task_key: TaskKey;
  name: string;
  interval_months: number;
  part_number: string | null;
}

export interface LookupResult {
  source: 'cache' | 'ai';
  appliance: ApplianceOut;
  tasks: TaskOut[];
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};

const taskName = (key: TaskKey) => TASKS.find((t) => t.id === key)?.name ?? key;

export function clampInterval(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_INTERVAL_MONTHS, Math.max(MIN_INTERVAL_MONTHS, Math.round(n)));
}

const byTaskOrder = (a: { task_key: string }, b: { task_key: string }) =>
  TASK_KEYS.indexOf(a.task_key as TaskKey) - TASK_KEYS.indexOf(b.task_key as TaskKey);

/** Cached model_tasks rows as the API's task list (known keys only, in TASKS order). */
export function tasksFromRows(
  rows: { task_key: unknown; name: unknown; interval_months: unknown; part_number: unknown }[] | null | undefined,
): TaskOut[] {
  const out: TaskOut[] = [];
  for (const r of rows ?? []) {
    if (!isTaskKey(r.task_key)) continue;
    out.push({
      task_key: r.task_key,
      name: text(r.name, 80) ?? taskName(r.task_key),
      interval_months: clampInterval(r.interval_months) ?? 12,
      part_number: text(r.part_number, 40),
    });
  }
  return out.sort(byTaskOrder);
}

// ---------------------------------------------------------------------------
// Claude plate reading
// ---------------------------------------------------------------------------

/** Structured-output schema for the plate reading. Every field is required; unknowns are "". */
export const PLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'brand', 'model', 'serial', 'name', 'category', 'note', 'tasks'],
  properties: {
    readable: { type: 'boolean', description: 'True only if a model number is legible on the plate.' },
    brand: { type: 'string', description: 'Manufacturer as printed, e.g. "LG ELECTRONICS". "" if unknown.' },
    model: { type: 'string', description: 'Model number exactly as printed. "" if not legible.' },
    serial: { type: 'string', description: 'Serial number exactly as printed. "" if not legible.' },
    name: { type: 'string', description: 'Short friendly name, e.g. "LG refrigerator" or "Carrier furnace".' },
    category: { type: 'string', enum: [...CATEGORIES] },
    note: { type: 'string', description: 'One short maintenance hint (max 30 chars), e.g. "Filter LT1000P". "" if none.' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task_key', 'name', 'interval_months', 'part_number'],
        properties: {
          task_key: { type: 'string', enum: [...TASK_KEYS] },
          name: { type: 'string' },
          interval_months: { type: 'integer', description: 'Service interval in months, 1 to 24.' },
          part_number: { type: 'string', description: 'Consumable part number for the task, or "".' },
        },
      },
    },
  },
} as const;

export const PLATE_SYSTEM_PROMPT = [
  'You read appliance rating plates (nameplates) from photos for a home maintenance company.',
  'Transcribe the brand, model number and serial number exactly as printed. Do not guess characters you cannot see;',
  'if the model number is not legible, set readable to false and leave the other fields empty.',
  'Then list the routine maintenance this appliance needs, using only these task keys:',
  ...TASK_KEYS.map((k) => `- ${k}: ${taskName(k)}`),
  'Include a task only when it applies to this appliance (a furnace gets hvac; a refrigerator with a water filter gets fridge,',
  'and ice if it has an ice maker; a dishwasher gets dish; a tank water heater gets wh; a clothes dryer gets dryer).',
  "Set interval_months from the manufacturer's recommendation (1 to 24).",
  'part_number is the consumable part the task uses (for example the water filter or air filter model), or "" when there is none.',
].join('\n');

export function platePrompt(hints: { brand?: unknown; model?: unknown; serial?: unknown }): string {
  const lines = ['Read this appliance plate.'];
  const brand = text(hints.brand, 60);
  const model = text(hints.model, 40);
  const serial = text(hints.serial, 40);
  if (brand || model || serial) {
    lines.push('The homeowner typed these hints; trust the plate over them if they disagree:');
    if (brand) lines.push(`brand: ${brand}`);
    if (model) lines.push(`model: ${model}`);
    if (serial) lines.push(`serial: ${serial}`);
  }
  return lines.join('\n');
}

export interface PlateReading {
  brand: string | null;
  model: string;
  serial: string | null;
  name: string;
  category: Category;
  note: string | null;
  tasks: TaskOut[];
}

const CATEGORY_LABEL: Record<Category, string> = {
  hvac: 'furnace',
  refrigerator: 'refrigerator',
  dishwasher: 'dishwasher',
  water_heater: 'water heater',
  dryer: 'dryer',
  washer: 'washer',
  other: 'appliance',
};

/**
 * Validates and normalizes the model's JSON. Returns null when the plate was
 * unreadable or the reply is unusable. Unknown task keys are dropped, intervals
 * clamped to 1..24, one task per key.
 */
export function normalizePlate(raw: unknown, hints: { brand?: unknown; serial?: unknown } = {}): PlateReading | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.readable !== true) return null;
  const model = cleanModel(r.model);
  const norm = normModel(model);
  if (norm.length < 3 || !/[0-9A-Z]/.test(norm)) return null;

  const category: Category = (CATEGORIES as readonly string[]).includes(r.category as string) ? (r.category as Category) : 'other';
  const brand = text(r.brand, 60) ?? text(hints.brand, 60);
  const name = text(r.name, 60) ?? `${brand ?? 'Home'} ${CATEGORY_LABEL[category]}`;

  const tasks: TaskOut[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(r.tasks) ? r.tasks : []) {
    if (!t || typeof t !== 'object') continue;
    const x = t as Record<string, unknown>;
    if (!isTaskKey(x.task_key) || seen.has(x.task_key)) continue;
    const interval = clampInterval(x.interval_months);
    if (interval === null) continue;
    seen.add(x.task_key);
    const part = text(x.part_number, 40);
    tasks.push({
      task_key: x.task_key,
      name: text(x.name, 80) ?? taskName(x.task_key),
      interval_months: interval,
      part_number: part ? part.toUpperCase() : null,
    });
  }
  tasks.sort(byTaskOrder);

  return {
    brand,
    model,
    serial: text(r.serial, 40) ?? text(hints.serial, 40),
    name,
    category,
    note: text(r.note, 40),
    tasks,
  };
}

/** Parses the text of the model's reply (structured output) into a reading, or null. */
export function parsePlateReply(replyText: string | null | undefined, hints: { brand?: unknown; serial?: unknown } = {}) {
  if (!replyText) return null;
  try {
    return normalizePlate(JSON.parse(replyText), hints);
  } catch {
    return null;
  }
}

/** Strips a data: URL prefix and whitespace from a base64 image. */
export function cleanBase64(image: unknown): { data: string; mediaType: ImageType | null } | null {
  if (typeof image !== 'string') return null;
  let data = image.trim();
  let mediaType: ImageType | null = null;
  const m = /^data:([^;,]+);base64,/i.exec(data);
  if (m) {
    const t = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
    mediaType = (IMAGE_TYPES as readonly string[]).includes(t) ? (t as ImageType) : null;
    data = data.slice(m[0].length);
  }
  // Accept URL-safe base64 too; the API wants the standard alphabet.
  data = data.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null;
  return { data, mediaType };
}

/** The image's media type: explicit field, then data-URL prefix, then magic bytes, else JPEG. */
export function resolveMediaType(explicit: unknown, fromPrefix: ImageType | null, data: string): ImageType | null {
  if (typeof explicit === 'string' && explicit.trim()) {
    const t = explicit.trim().toLowerCase() === 'image/jpg' ? 'image/jpeg' : explicit.trim().toLowerCase();
    return (IMAGE_TYPES as readonly string[]).includes(t) ? (t as ImageType) : null;
  }
  if (fromPrefix) return fromPrefix;
  if (data.startsWith('iVBORw0KGgo')) return 'image/png';
  if (data.startsWith('R0lGOD')) return 'image/gif';
  if (data.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}
