// Row-level security and RPC guards, checked straight against the API with
// supabase-js as each demo account (no browser).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from './fixtures';
import { SEED, anonClient, api, chicagoDate, requireBackend, resetDemo, type Account } from './helpers';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: PostgrestError | null };

async function rows(label: string, q: PromiseLike<Result>): Promise<Row[]> {
  const { data, error } = await q;
  expect(error, `${label}: ${error?.message}`).toBeNull();
  return (data ?? []) as Row[];
}

/** Rejected = an error, or nothing written/returned (RLS filtered every row). */
async function expectRejected(label: string, q: PromiseLike<Result>): Promise<void> {
  const { data, error } = await q;
  const rejected = error !== null || data === null || (Array.isArray(data) && data.length === 0);
  expect(rejected, `${label} should be rejected, but returned ${JSON.stringify(data)}`).toBe(true);
}

async function expectRpcError(label: string, q: PromiseLike<Result>): Promise<void> {
  const { error } = await q;
  expect(error, `${label} should fail`).not.toBeNull();
}

const ALL_TABLES = [
  'profiles',
  'homes',
  'appliances',
  'plans',
  'plan_builds',
  'visits',
  'visit_tasks',
  'visit_photos',
  'reports',
  'notices',
  'vendors',
  'quote_requests',
  'bids',
  'pricing_settings',
  'task_defaults',
  'appliance_models',
  'model_tasks',
  'parts',
  'part_prices',
  'service_categories',
];

test.describe('RLS and RPC guards (API only)', () => {
  requireBackend();

  test.beforeAll(async () => {
    await resetDemo();
  });

  test('anon (no login) reads nothing and cannot call RPCs', async () => {
    const anon = anonClient();
    for (const t of ALL_TABLES) {
      await expectRejected(`anon select ${t}`, anon.from(t).select('*').limit(5));
    }
    await expectRpcError('anon reset_demo', anon.rpc('reset_demo'));
    await expectRpcError('anon advance_visit', anon.rpc('advance_visit', { p_visit: SEED.visits.elena }));
    await expectRpcError('anon request_quote', anon.rpc('request_quote', { p_category: 'win' }));
  });

  test('Elena reads only her own home, visits and people', async () => {
    const elena = await api('homeowner');
    const homes = await rows('elena homes', elena.from('homes').select('id, owner_id, address'));
    expect(homes).toHaveLength(1);
    expect(homes[0]).toMatchObject({ id: SEED.homes.elena, owner_id: SEED.users.elena });

    const visits = await rows('elena visits', elena.from('visits').select('id, home_id'));
    expect(visits.length).toBeGreaterThan(0);
    for (const v of visits) expect(v.home_id).toBe(SEED.homes.elena);

    const profiles = await rows('elena profiles', elena.from('profiles').select('id, role'));
    const owners = profiles.filter((p) => p.role === 'homeowner').map((p) => p.id);
    expect(owners).toEqual([SEED.users.elena]);
  });

  test('Elena cannot call office or tech RPCs', async () => {
    const elena = await api('homeowner');
    await expectRpcError('elena reset_demo', elena.rpc('reset_demo'));
    await expectRpcError('elena send_48h_reminders', elena.rpc('send_48h_reminders'));
    await expectRpcError('elena advance_visit on her own visit', elena.rpc('advance_visit', { p_visit: SEED.visits.elena }));
    const office = await api('office');
    const [visit] = await rows('office reads the visit', office.from('visits').select('status').eq('id', SEED.visits.elena));
    expect(visit.status).toBe('scheduled');
  });

  test('the vendor reads no homes, appliances, visits or homeowner profiles', async () => {
    const vendor = await api('vendor');
    for (const t of ['homes', 'appliances', 'plans', 'visits', 'visit_tasks', 'reports', 'notices']) {
      expect(await rows(`vendor ${t}`, vendor.from(t).select('*').limit(5)), `vendor reads ${t}`).toHaveLength(0);
    }
    const profiles = await rows('vendor profiles', vendor.from('profiles').select('id, role'));
    expect(profiles.filter((p) => p.role === 'homeowner')).toHaveLength(0);
  });

  test('the vendor sees a request’s area but no owner details, and only its own bids', async () => {
    const elena = await api('homeowner');
    const vendor = await api('vendor');

    const { data: req, error } = await elena.rpc('request_quote', { p_category: 'win' });
    expect(error, error?.message).toBeNull();
    const requestId = (req as Row).id as string;

    const seen = await rows('vendor quote_requests', vendor.from('quote_requests').select('*').eq('id', requestId));
    expect(seen).toHaveLength(1);
    expect(String(seen[0].area)).toContain('Linden Court');
    const text = JSON.stringify(seen[0]);
    for (const secret of ['Elena', 'Alvarez', 'homeowner@php.test', SEED.users.elena]) expect(text).not.toContain(secret);
    // Following the foreign key to the home finds nothing.
    const embedded = await rows('vendor request→home', vendor.from('quote_requests').select('id, homes(owner_id, address)').eq('id', requestId));
    expect(embedded[0].homes).toBeNull();

    // Network vendors bid through the fanout-quote edge function (service role).
    const { error: fanErr } = await elena.functions.invoke('fanout-quote', { body: { request_id: requestId } });
    expect(fanErr, `fanout-quote: ${fanErr?.message}`).toBeNull();
    await expect
      .poll(
        async () => (await rows('elena bids', elena.from('bids').select('vendor_id').eq('request_id', requestId))).length,
        { timeout: 20_000, message: 'network bids from fanout-quote' },
      )
      .toBeGreaterThan(0);

    const { error: bidErr } = await vendor.rpc('submit_bid', { p_request: requestId, p_price: 400, p_available_on: chicagoDate(3) });
    expect(bidErr, bidErr?.message).toBeNull();

    const mine = await rows('vendor bids', vendor.from('bids').select('vendor_id, request_id'));
    expect(mine).toHaveLength(1);
    expect(mine[0].vendor_id).toBe(SEED.vendors.evergreen);
    const all = await rows('elena bids', elena.from('bids').select('vendor_id').eq('request_id', requestId));
    expect(all.length).toBeGreaterThan(1);
  });

  test('the tech cannot read vendors and sees only his own visits', async () => {
    const tech = await api('tech');
    expect(await rows('tech vendors', tech.from('vendors').select('*'))).toHaveLength(0);
    const visits = await rows('tech visits', tech.from('visits').select('id, tech_id'));
    expect(visits.length).toBeGreaterThan(0);
    for (const v of visits) expect(v.tech_id).toBe(SEED.users.marcus);
  });

  test('direct table writes are rejected for homeowner, tech and vendor', async () => {
    const office = await api('office');
    const [before] = await rows('office pricing', office.from('pricing_settings').select('labor_rate').eq('id', 1));
    const [hvacBefore] = await rows('office task_defaults', office.from('task_defaults').select('labor_min').eq('task_key', 'hvac'));
    const homesBefore = (await rows('office homes', office.from('homes').select('id'))).length;
    const vendorsBefore = await rows('office vendors', office.from('vendors').select('id, vetted, company').order('id'));

    const attempts: Record<Exclude<Account, 'office' | 'newhome'>, (sb: SupabaseClient, self: string) => [string, PromiseLike<Result>][]> = {
      homeowner: (sb, self) => [
        ['insert homes', sb.from('homes').insert({ owner_id: self, address: '1 Hack St' }).select()],
        ['update homes', sb.from('homes').update({ address: '1 Hack St' }).eq('id', SEED.homes.elena).select()],
        ['insert visits', sb.from('visits').insert({ home_id: SEED.homes.elena, status: 'scheduled' }).select()],
        ['update visits', sb.from('visits').update({ status: 'done' }).eq('id', SEED.visits.elena).select()],
        ['delete visits', sb.from('visits').delete().eq('id', SEED.visits.elena).select()],
        ['insert quote_requests', sb.from('quote_requests').insert({ home_id: SEED.homes.elena, category: 'tree' }).select()],
        ['update profiles role', sb.from('profiles').update({ role: 'office' }).eq('id', self).select()],
        ['update pricing_settings', sb.from('pricing_settings').update({ labor_rate: 999 }).eq('id', 1).select()],
        ['insert task_defaults', sb.from('task_defaults').insert({ task_key: 'hack', name: 'Hack' }).select()],
        ['insert reports', sb.from('reports').insert({ visit_id: SEED.visits.elena, health_score: 1 }).select()],
      ],
      tech: (sb) => [
        ['update visits', sb.from('visits').update({ status: 'done' }).eq('id', SEED.visits.elena).select()],
        ['update visit_tasks', sb.from('visit_tasks').update({ done: true }).eq('visit_id', SEED.visits.elena).select()],
        ['insert notices', sb.from('notices').insert({ visit_id: SEED.visits.elena, kind: 'enroute', channel: 'push' }).select()],
        ['insert reports', sb.from('reports').insert({ visit_id: SEED.visits.elena, health_score: 1 }).select()],
        ['update pricing_settings', sb.from('pricing_settings').update({ labor_rate: 999 }).eq('id', 1).select()],
        ['update task_defaults', sb.from('task_defaults').update({ labor_min: 1 }).eq('task_key', 'hvac').select()],
      ],
      vendor: (sb, self) => [
        ['insert vendors', sb.from('vendors').insert({ profile_id: self, company: 'Hack Co.', vetted: true }).select()],
        ['update vendors', sb.from('vendors').update({ vetted: false }).eq('id', SEED.vendors.evergreen).select()],
        ['insert quote_requests', sb.from('quote_requests').insert({ home_id: SEED.homes.elena, category: 'tree' }).select()],
        ['update quote_requests', sb.from('quote_requests').update({ status: 'canceled' }).neq('status', 'canceled').select()],
        ['update pricing_settings', sb.from('pricing_settings').update({ labor_rate: 999 }).eq('id', 1).select()],
        ['insert profiles', sb.from('profiles').insert({ id: self, role: 'office' }).select()],
      ],
    };

    const self = { homeowner: SEED.users.elena, tech: SEED.users.marcus, vendor: SEED.users.sam };
    for (const account of ['homeowner', 'tech', 'vendor'] as const) {
      const sb = await api(account);
      for (const [label, q] of attempts[account](sb, self[account])) await expectRejected(`${account} ${label}`, q);
    }
    // Vendors can't insert bids directly either (only submit_bid).
    const vendor = await api('vendor');
    const { data: req } = await (await api('homeowner')).rpc('request_quote', { p_category: 'press' });
    await expectRejected(
      'vendor insert bids',
      vendor
        .from('bids')
        .insert({ request_id: (req as Row).id, vendor_id: SEED.vendors.evergreen, price: 1, available_on: chicagoDate(2) })
        .select(),
    );

    // Nothing changed underneath.
    const [after] = await rows('office pricing', office.from('pricing_settings').select('labor_rate').eq('id', 1));
    expect(Number(after.labor_rate)).toBe(Number(before.labor_rate));
    const [hvac] = await rows('office task_defaults', office.from('task_defaults').select('labor_min').eq('task_key', 'hvac'));
    expect(Number(hvac.labor_min)).toBe(Number(hvacBefore.labor_min));
    expect((await rows('office homes', office.from('homes').select('id'))).length).toBe(homesBefore);
    const [visit] = await rows('office visit', office.from('visits').select('status').eq('id', SEED.visits.elena));
    expect(visit.status).toBe('scheduled');
    const tasksDone = await rows('office tasks', office.from('visit_tasks').select('done').eq('visit_id', SEED.visits.elena).eq('done', true));
    expect(tasksDone).toHaveLength(0);
    const roles = await rows('office profiles', office.from('profiles').select('id, role').in('id', Object.values(self)));
    expect(Object.fromEntries(roles.map((r) => [r.id, r.role]))).toEqual({
      [SEED.users.elena]: 'homeowner',
      [SEED.users.marcus]: 'tech',
      [SEED.users.sam]: 'vendor',
    });
    expect(await rows('office vendors', office.from('vendors').select('id, vetted, company').order('id'))).toEqual(vendorsBefore);
    const bids = await rows('office bids', office.from('bids').select('id').eq('request_id', (req as Row).id as string));
    expect(bids).toHaveLength(0);
  });
});
