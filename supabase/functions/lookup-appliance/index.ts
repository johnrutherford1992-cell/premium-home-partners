// lookup-appliance: resolves an appliance from a typed model number (cache) or
// a photo of its rating plate (Claude vision + structured output), and caches
// new models and their maintenance tasks.
//
// GET  → 200 { ok: true, ai: boolean }   (is plate reading configured?)
// POST { model?, brand?, serial?, image?: base64, media_type? }
//   → 200 { source: 'cache'|'ai', appliance: {...}, tasks: [...] }
//   → 503 { code: 'no_key' } · 422 { code: 'unreadable' } · 404 { code: 'not_found' }
// See docs/LIVE_ARCHITECTURE.md §5.

import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  LOOKUP_MSG,
  MAX_IMAGE_BASE64,
  PLATE_SCHEMA,
  PLATE_SYSTEM_PROMPT,
  cleanBase64,
  modelLikePattern,
  normModel,
  parsePlateReply,
  pickCachedModel,
  platePrompt,
  resolveMediaType,
  tasksFromRows,
  type ImageType,
  type LookupResult,
  type PlateReading,
} from '../_shared/appliance.ts';
import { MSG, allowMethods, errorText, fail, json, preflight, readJsonObject } from '../_shared/http.ts';
import { adminClient, requireCaller } from '../_shared/supabase.ts';

const MODEL = 'claude-opus-5-5';
const AI_TIMEOUT_MS = 20_000;
const MAX_TOKENS = 4096;
// Server-side refusal fallback (routes a classifier decline to another model).
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbackAccepted = true;

const apiKey = () => Deno.env.get('ANTHROPIC_API_KEY')?.trim() || null;

Deno.serve(async (req) => {
  const early = preflight(req) ?? allowMethods(req, ['GET', 'POST']);
  if (early) return early;

  // Pre-demo check: is plate reading configured? Never reveals the key.
  if (req.method === 'GET') return json({ ok: true, ai: apiKey() !== null });

  try {
    const caller = await requireCaller(req);
    if (caller instanceof Response) return caller;

    const body = await readJsonObject(req);
    if (!body) return fail(400, MSG.badRequest, 'bad_request');
    const hasImage = typeof body.image === 'string' && body.image.trim() !== '';
    const typed = normModel(body.model);
    if (!typed && !hasImage) return fail(400, LOOKUP_MSG.missing, 'missing');

    // 1. Cache by the typed model number.
    if (typed) {
      const hit = await fromCache(caller.db, typed, { brand: body.brand, serial: body.serial });
      if (hit) return json(hit);
    }
    if (!hasImage) return fail(404, LOOKUP_MSG.notFound, 'not_found');

    // 2. Read the plate.
    const key = apiKey();
    if (!key) return fail(503, LOOKUP_MSG.noKey, 'no_key');
    const img = cleanBase64(body.image);
    if (!img) return fail(400, LOOKUP_MSG.badImage, 'bad_image');
    if (img.data.length > MAX_IMAGE_BASE64) return fail(413, LOOKUP_MSG.tooLarge, 'too_large');
    const mediaType = resolveMediaType(body.media_type, img.mediaType, img.data);
    if (!mediaType) return fail(400, LOOKUP_MSG.badImage, 'bad_image');

    const read = await readPlate(key, img.data, mediaType, { brand: body.brand, model: body.model, serial: body.serial });
    if (read.kind === 'unreadable') return fail(422, LOOKUP_MSG.unreadable, 'unreadable');
    if (read.kind === 'error') return fail(502, LOOKUP_MSG.unreadable, 'ai_error');
    const reading = read.reading;

    // 3. Re-check the cache by the model number on the plate, else store it.
    const hit = await fromCache(caller.db, normModel(reading.model), { brand: reading.brand, serial: reading.serial });
    if (hit) return json(hit);
    return json(await store(reading));
  } catch (e) {
    console.error('lookup-appliance failed:', errorText(e));
    return fail(500, MSG.server, 'server');
  }
});

interface CachedModel {
  id: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  name: string | null;
  note: string | null;
}

const MODEL_COLUMNS = 'id, brand, model, category, name, note';

const cleanText = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function result(source: LookupResult['source'], m: CachedModel, extras: { brand?: unknown; serial?: unknown }, tasks: LookupResult['tasks']): LookupResult {
  return {
    source,
    appliance: {
      brand: m.brand ?? cleanText(extras.brand, 60),
      name: m.name,
      model: m.model ?? '',
      serial: cleanText(extras.serial, 40),
      category: m.category,
      note: m.note,
      model_id: m.id,
    },
    tasks,
  };
}

/** The cached model whose number matches ignoring case, spaces and dashes. */
async function fromCache(
  db: SupabaseClient,
  norm: string,
  extras: { brand?: unknown; serial?: unknown },
): Promise<LookupResult | null> {
  if (!norm) return null;
  const { data, error } = await db
    .from('appliance_models')
    .select(MODEL_COLUMNS)
    .ilike('model', modelLikePattern(norm))
    .limit(25)
    .returns<CachedModel[]>();
  if (error) throw error;
  const m = pickCachedModel(data, norm);
  if (!m) return null;
  const { data: rows, error: tasksError } = await db
    .from('model_tasks')
    .select('task_key, name, interval_months, part_number')
    .eq('model_id', m.id);
  if (tasksError) throw tasksError;
  return result('cache', m, extras, tasksFromRows(rows));
}

/** Inserts a new model and its tasks with the service role. */
async function store(reading: PlateReading): Promise<LookupResult> {
  const db = adminClient();
  const extras = { brand: reading.brand, serial: reading.serial };
  const { data: m, error } = await db
    .from('appliance_models')
    .insert({
      brand: reading.brand,
      model: reading.model,
      category: reading.category,
      name: reading.name,
      note: reading.note,
      extracted_at: new Date().toISOString(),
    })
    .select(MODEL_COLUMNS)
    .single<CachedModel>();
  if (error || !m) {
    // Another lookup stored the same model a moment ago: serve that one.
    if (error?.code === '23505') {
      const hit = await fromCache(db, normModel(reading.model), extras);
      if (hit) return hit;
    }
    throw error ?? new Error('appliance_models insert returned no row');
  }
  if (reading.tasks.length) {
    const { error: tasksError } = await db
      .from('model_tasks')
      .insert(reading.tasks.map((t) => ({ model_id: m.id, ...t })));
    if (tasksError) {
      // Don't leave a model without its tasks in the cache; the next scan retries.
      await db.from('appliance_models').delete().eq('id', m.id);
      throw tasksError;
    }
  }
  return result('ai', m, extras, reading.tasks);
}

/** Thrown to skip straight to the plain request once the fallback beta was rejected. */
class FallbackUnavailable extends Error {}

type ReadOutcome = { kind: 'ok'; reading: PlateReading } | { kind: 'unreadable' } | { kind: 'error' };

/** One Claude call with the photo; 20 s budget, no retries. */
async function readPlate(
  key: string,
  data: string,
  mediaType: ImageType,
  hints: { brand?: unknown; model?: unknown; serial?: unknown },
): Promise<ReadOutcome> {
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: AI_TIMEOUT_MS });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: PLATE_SYSTEM_PROMPT,
    // Thinking is always on for this model; low effort keeps the reading fast.
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: PLATE_SCHEMA } },
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } },
          { type: 'text' as const, text: platePrompt(hints) },
        ],
      },
    ],
  };
  const started = Date.now();
  try {
    let stop: string | null;
    let content: { type: string; text?: string }[];
    try {
      if (!fallbackAccepted) throw new FallbackUnavailable();
      const msg = await client.beta.messages.create(
        { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' },
        { signal: controller.signal },
      );
      stop = msg.stop_reason;
      content = msg.content;
    } catch (e) {
      const rejected = e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message);
      if (!(e instanceof FallbackUnavailable) && !rejected) throw e;
      if (rejected) {
        fallbackAccepted = false;
        console.warn('lookup-appliance: refusal fallback not accepted for this model; calling without it');
      }
      const msg = await client.messages.create(params, { signal: controller.signal });
      stop = msg.stop_reason;
      content = msg.content;
    }
    console.log(`lookup-appliance: plate read in ${Date.now() - started} ms (stop: ${stop})`);
    if (stop === 'refusal' || stop === 'max_tokens') return { kind: 'unreadable' };
    const text = content.find((b) => b.type === 'text')?.text;
    const reading = parsePlateReply(text, hints);
    return reading ? { kind: 'ok', reading } : { kind: 'unreadable' };
  } catch (e) {
    if (controller.signal.aborted || e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) {
      console.warn(`lookup-appliance: plate read timed out after ${Date.now() - started} ms`);
      return { kind: 'unreadable' };
    }
    const status = e instanceof Anthropic.APIError ? ` (HTTP ${e.status})` : '';
    console.error(`lookup-appliance: plate read failed${status}:`, errorText(e));
    return { kind: 'error' };
  } finally {
    clearTimeout(timer);
  }
}
