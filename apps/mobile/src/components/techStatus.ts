import type { TechStatus } from '../store/app';
import type { Tone } from '../theme/tokens';

export const TECH_STATUS: Record<TechStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  enroute: { label: 'En route', tone: 'slate' },
  onsite: { label: 'On site', tone: 'slate' },
  done: { label: 'Complete', tone: 'forest' },
};
