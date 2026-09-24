import { money } from '@php/pricing';
import type { QuoteRequest } from '../store/app';
import { STATUS } from '../theme/tokens';
import type { Palette } from '../theme/tokens';

/** How a request looks from the signed-in vendor's side. */
export function vendorView(r: QuoteRequest, c: Palette) {
  const mi = r.bids.findIndex((b) => b.mine);
  const won = r.booked != null && r.booked === mi && mi >= 0;
  const lost = r.booked != null && !won;
  return {
    hasMine: mi >= 0,
    won,
    closed: r.booked != null,
    myPrice: mi >= 0 ? money(r.bids[mi].price) : '',
    status: won ? 'Won · scheduled' : lost ? 'Not selected' : mi >= 0 ? 'Quote sent' : 'New request',
    color: won ? STATUS.forest : lost ? c.muted : mi >= 0 ? STATUS.slate : c.accent,
    bidsTxt: `${r.bids.length} bid${r.bids.length === 1 ? '' : 's'} so far${r.booked != null ? ' · closed' : ''}`,
  };
}
