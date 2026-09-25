// build-plan: researches a home and prices all four tiers with the shared
// pricing module, writing progress to plan_builds so the homeowner's research
// screen can follow it (Realtime, with polling as the floor).
//
// POST { home_id }  → 202 { build_id }
// then, in the background, roughly every 700 ms:
//   8 reading → 28 manuals → 50 tasks → 74 parts → 94 adjusting → 100 ready (options)
// On any failure the row gets step 'error' and a user-facing `error`.
// See docs/LIVE_ARCHITECTURE.md §5.

import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';
import { MSG, allowMethods, background, errorText, fail, isUuid, json, preflight, readJsonObject, sleep } from '../_shared/http.ts';
import {
  BUILD_ERROR,
  BUILD_STEPS,
  INITIAL_STEP,
  buildOptions,
  countTasks,
  emptySummary,
  lowestInStock,
  matchModels,
  partNumbersToPrice,
  waitBeforeNext,
  type ApplianceRow,
  type BuildStep,
  type ModelRow,
  type PriceRow,
} from '../_shared/plan.ts';
import { adminClient, requireCaller } from '../_shared/supabase.ts';

interface HomeRow {
  id: string;
  owner_id: string;
  pets: boolean | null;
  water: string | null;
}

Deno.serve(async (req) => {
  const early = preflight(req) ?? allowMethods(req, ['POST']);
  if (early) return early;
  try {
    const caller = await requireCaller(req);
    if (caller instanceof Response) return caller;

    const body = await readJsonObject(req);
    const homeId = body?.home_id;
    if (!isUuid(homeId)) return fail(400, MSG.badRequest, 'bad_request');

    // Ownership through the caller's JWT: RLS hides homes they can't see.
    const { data: home, error } = await caller.db
      .from('homes')
      .select('id, owner_id, pets, water')
      .eq('id', homeId)
      .maybeSingle<HomeRow>();
    if (error) throw error;
    if (!home) return fail(404, "We couldn't find that home.", 'not_found');
    if (home.owner_id !== caller.userId) return fail(403, MSG.forbidden, 'forbidden');

    const { data: build, error: insertError } = await adminClient()
      .from('plan_builds')
      .insert({
        home_id: home.id,
        status: 'running',
        step: INITIAL_STEP.step,
        progress: INITIAL_STEP.progress,
        summary: emptySummary(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single<{ id: string }>();
    if (insertError || !build) throw insertError ?? new Error('plan_builds insert returned no row');

    background(runBuild(build.id, home));
    return json({ build_id: build.id }, 202);
  } catch (e) {
    console.error('build-plan failed:', errorText(e));
    return fail(500, MSG.server, 'server');
  }
});

async function runBuild(buildId: string, home: HomeRow): Promise<void> {
  const db = adminClient();
  const summary = emptySummary();
  const [READING, MANUALS, TASKS, PARTS, ADJUSTING, READY] = BUILD_STEPS;
  let lastAt = Date.now();

  const advance = async (s: { step: BuildStep; progress: number }, extra: Record<string, unknown> = {}) => {
    await sleep(waitBeforeNext(lastAt, Date.now()));
    const { error } = await db
      .from('plan_builds')
      .update({ step: s.step, progress: s.progress, summary, updated_at: new Date().toISOString(), ...extra })
      .eq('id', buildId);
    if (error) throw error;
    lastAt = Date.now();
  };

  try {
    // 8 · reading: count the home's appliances.
    const { data: appliances, error: appliancesError } = await db
      .from('appliances')
      .select('model_id, model')
      .eq('home_id', home.id)
      .returns<ApplianceRow[]>();
    if (appliancesError) throw appliancesError;
    summary.appliances = appliances?.length ?? 0;
    await advance(READING);

    // 28 · manuals: appliances matched to cached models (linked, or by model number).
    let models: ModelRow[] = [];
    if ((appliances ?? []).some((a) => !a.model_id && a.model)) {
      const { data, error } = await db.from('appliance_models').select('id, model').limit(1000).returns<ModelRow[]>();
      if (error) throw error;
      models = data ?? [];
    }
    const modelIds = matchModels(appliances ?? [], models);
    summary.manuals = modelIds.length;
    await advance(MANUALS);

    // 50 · tasks: maintenance tasks from those manuals.
    let modelTasks: { task_key: string | null; part_number: string | null }[] = [];
    if (modelIds.length) {
      const { data, error } = await db.from('model_tasks').select('task_key, part_number').in('model_id', modelIds);
      if (error) throw error;
      modelTasks = data ?? [];
    }
    summary.tasks = countTasks(modelTasks);
    await advance(TASKS);

    // 74 · parts: lowest in-stock price per part.
    const partNumbers = partNumbersToPrice(modelTasks);
    const { data: partRows, error: partsError } = await db
      .from('parts')
      .select('part_number, description, part_prices(supplier, price, in_stock)')
      .in('part_number', partNumbers);
    if (partsError) throw partsError;
    const prices: PriceRow[] = [];
    for (const p of (partRows ?? []) as {
      part_number: string;
      description: string | null;
      part_prices: { supplier: string | null; price: unknown; in_stock: boolean | null }[] | null;
    }[]) {
      for (const pp of p.part_prices ?? []) prices.push({ part_number: p.part_number, description: p.description, ...pp });
    }
    const priced = lowestInStock(partNumbers, prices);
    summary.parts = priced.parts;
    summary.suppliers = priced.suppliers;
    await advance(PARTS);

    // 94 · adjusting: price all tiers at the live settings for this home.
    const [settingsRes, defaultsRes] = await Promise.all([
      db.from('pricing_settings').select('labor_rate, trip_fee, parts_markup, tech_cost, vehicle_cost').eq('id', 1).maybeSingle(),
      db.from('task_defaults').select('task_key, labor_min, freq_high, freq_recommended, freq_medium, freq_low'),
    ]);
    if (settingsRes.error) throw settingsRes.error;
    if (defaultsRes.error) throw defaultsRes.error;
    const options = buildOptions(settingsRes.data, defaultsRes.data, home);
    await advance(ADJUSTING);

    // 100 · ready.
    await advance(READY, { status: 'ready', options, error: null });
  } catch (e) {
    console.error(`build-plan ${buildId} failed:`, errorText(e));
    const { error } = await db
      .from('plan_builds')
      .update({ step: 'error', status: 'error', error: BUILD_ERROR, updated_at: new Date().toISOString() })
      .eq('id', buildId);
    if (error) console.error(`build-plan ${buildId}: couldn't record the error:`, errorText(error));
  }
}
