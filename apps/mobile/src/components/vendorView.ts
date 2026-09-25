import { money } from '@php/pricing';
import { STATUS } from '../theme/tokens';
import type { Palette } from '../theme/tokens';

/**
 * What vendorView needs from a request, in either mode (see data/vendor.ts):
 * the bid count, the signed-in vendor's own bid, and whether (and to which
 * bid) the request was booked.
 */
export interface VendorViewInput {
  status: 'open' | 'booked' | 'canceled';
  bookedBidId: string | null;
  bidCount: number;
  myBid: { id: string; price: number } | null;
}

/** How a request looks from the signed-in vendor's side. */
export function vendorView(r: VendorViewInput, c: Palette) {
  const mine = r.myBid;
  const booked = r.status === 'booked';
  const won = booked && mine != null && r.bookedBidId === mine.id;
  const lost = booked && !won;
  const closed = r.status !== 'open';
  return {
    hasMine: mine != null,
    won,
    closed,
    myPrice: mine ? money(mine.price) : '',
    status: won ? 'Won · scheduled' : lost ? 'Not selected' : mine ? 'Quote sent' : 'New request',
    color: won ? STATUS.forest : lost ? c.muted : mine ? STATUS.slate : c.accent,
    bidsTxt: `${r.bidCount} bid${r.bidCount === 1 ? '' : 's'} so far${closed ? ' · closed' : ''}`,
  };
}
