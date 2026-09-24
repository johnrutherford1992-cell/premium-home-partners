// build-plan: prices all four tiers for a home with the shared pricing module and
// writes progress to plan_builds so the homeowner's research screen can follow it
// over Realtime.
//
// POST { home_id: string }  → { build_id, options: TierQuote[] }

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  DEFAULT_FREQ,
  DEFAULT_MINUTES,
  DEFAULT_SETTINGS,
  priceAllTiers,
  type Frequencies,
  type LaborMinutes,
  type Water,
} from '../../../packages/pricing/src/index.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  // The caller's JWT scopes reads to homes they own; the service client writes progress.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { home_id } = await req.json().catch(() => ({}));
  if (!home_id) return Response.json({ error: 'home_id required' }, { status: 400 });

  const { data: home, error: homeErr } = await asUser.from('homes').select('id, pets, water').eq('id', home_id).single();
  if (homeErr || !home) return Response.json({ error: 'home not found' }, { status: 404 });

  const { data: build } = await admin.from('plan_builds').insert({ home_id, status: 'pricing', progress: 10 }).select('id').single();

  const [{ data: s }, { data: defaults }] = await Promise.all([
    admin.from('pricing_settings').select('*').eq('id', 1).single(),
    admin.from('task_defaults').select('*'),
  ]);

  const minutes: LaborMinutes = { ...DEFAULT_MINUTES };
  const freq: Frequencies = { ...DEFAULT_FREQ };
  for (const d of defaults ?? []) {
    minutes[d.task_key] = d.labor_min;
    freq[d.task_key] = [d.freq_high, d.freq_recommended, d.freq_medium, d.freq_low];
  }

  const options = priceAllTiers({
    settings: s
      ? {
          rate: Number(s.labor_rate),
          trip: Number(s.trip_fee),
          markup: Number(s.parts_markup) * 100,
          techCost: Number(s.tech_cost),
          vehicleCostPerVisit: Number(s.vehicle_cost),
        }
      : DEFAULT_SETTINGS,
    minutes,
    freq,
    home: { pets: !!home.pets, water: (home.water ?? 'city_hard') as Water },
  });

  await admin.from('plan_builds').update({ status: 'ready', progress: 100, options }).eq('id', build!.id);
  return Response.json({ build_id: build!.id, options });
});
