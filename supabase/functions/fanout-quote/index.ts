// fanout-quote: after a homeowner requests an add-on quote, two network vendors
// bid automatically, so the homeowner sees competing bids next to the real
// vendor's. The client calls it fire-and-forget after request_quote.
//
// POST { request_id } → 202 { ok: true, request_id }
// then, in the background:
//   +1.5 s  Summit Pro Services  round(base × 0.88), available today + 4 (Chicago)
//   +1.3 s  Clearview & Sons     round(base × 1.14), available today + 6
// A vendor is skipped when the request is no longer open or it already bid.
// See docs/LIVE_ARCHITECTURE.md §5.

import 'jsr:@supabase/functions-js@2/edge-runtime.d.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { MSG, allowMethods, background, errorText, fail, isUuid, json, preflight, readJsonObject, sleep } from '../_shared/http.ts';
import { NETWORK_VENDORS, addDays, chicagoToday, networkBidPrice, skipReason, type NetworkVendor } from '../_shared/quote.ts';
import { adminClient, requireCaller } from '../_shared/supabase.ts';

interface VendorRow {
  id: string;
  company: string;
  categories: string[] | null;
  vetted: boolean | null;
}

Deno.serve(async (req) => {
  const early = preflight(req) ?? allowMethods(req, ['POST']);
  if (early) return early;
  try {
    const caller = await requireCaller(req);
    if (caller instanceof Response) return caller;

    const body = await readJsonObject(req);
    const requestId = body?.request_id;
    if (!isUuid(requestId)) return fail(400, MSG.badRequest, 'bad_request');

    // Ownership through the caller's JWT: the home embed is visible only to its owner (and office).
    const { data: request, error } = await caller.db
      .from('quote_requests')
      .select('id, homes!inner(owner_id)')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw error;
    if (!request) return fail(404, "We couldn't find that request.", 'not_found');
    const homes = (request as { homes: { owner_id: string } | { owner_id: string }[] | null }).homes;
    const ownerId = Array.isArray(homes) ? homes[0]?.owner_id : homes?.owner_id;
    if (ownerId !== caller.userId) return fail(403, MSG.forbidden, 'forbidden');

    background(fanOut(requestId));
    return json({ ok: true, request_id: requestId }, 202);
  } catch (e) {
    console.error('fanout-quote failed:', errorText(e));
    return fail(500, MSG.server, 'server');
  }
});

async function fanOut(requestId: string): Promise<void> {
  const db = adminClient();
  const { data: vendors, error } = await db
    .from('vendors')
    .select('id, company, categories, vetted')
    .is('profile_id', null)
    .in('company', NETWORK_VENDORS.map((v) => v.company))
    .returns<VendorRow[]>();
  if (error) throw error;
  for (const nv of NETWORK_VENDORS) {
    await sleep(nv.delayMs);
    try {
      await placeBid(db, requestId, nv, vendors ?? []);
    } catch (e) {
      console.error(`fanout-quote ${requestId}: ${nv.company} bid failed:`, errorText(e));
    }
  }
}

async function placeBid(db: SupabaseClient, requestId: string, nv: NetworkVendor, vendors: VendorRow[]): Promise<void> {
  const { data: request, error } = await db
    .from('quote_requests')
    .select('status, base, category')
    .eq('id', requestId)
    .maybeSingle<{ status: string | null; base: unknown; category: string | null }>();
  if (error) throw error;

  const vendor = vendors.find(
    (v) =>
      v.company === nv.company &&
      v.vetted !== false &&
      (!v.categories || !request?.category || v.categories.includes(request.category)),
  );
  let alreadyBid = false;
  if (vendor) {
    const { data: existing, error: bidError } = await db
      .from('bids')
      .select('id')
      .eq('request_id', requestId)
      .eq('vendor_id', vendor.id)
      .maybeSingle();
    if (bidError) throw bidError;
    alreadyBid = !!existing;
  }
  const price = networkBidPrice(request?.base, nv.factor);
  const skip = skipReason({ status: request?.status, vendorId: vendor?.id, alreadyBid, price });
  if (skip) {
    console.log(`fanout-quote ${requestId}: ${nv.company} skipped (${skip})`);
    return;
  }

  // vendor_name / vendor_rating are copied by a trigger; bid_count follows.
  const { error: insertError } = await db
    .from('bids')
    .upsert(
      { request_id: requestId, vendor_id: vendor!.id, price, available_on: addDays(chicagoToday(), nv.days) },
      { onConflict: 'request_id,vendor_id', ignoreDuplicates: true },
    );
  if (insertError) throw insertError;
}
