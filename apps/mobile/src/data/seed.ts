// Sample data used by demo mode. Mirrors the connected prototype.

export interface Appliance {
  brand: string;
  name: string;
  model: string;
  serial: string;
  note: string;
}

export const APPLIANCES: Appliance[] = [
  { brand: 'CARRIER CORP.', name: 'Carrier Infinity furnace', model: '59TN6B100V21', serial: '2419A83715', note: 'Filter 16×25×4' },
  { brand: 'LG ELECTRONICS', name: 'LG refrigerator', model: 'LRMVS3006S', serial: '309KRBD4Y771', note: 'Filter LT1000P' },
  { brand: 'BSH HOME APPL.', name: 'Bosch 800 dishwasher', model: 'SHPM88Z75N', serial: 'FD9912 00471', note: 'Filter monthly' },
  { brand: 'RHEEM MFG CO.', name: 'Rheem water heater', model: 'XE50T10H45U0', serial: 'Q461504231', note: '11 yrs · flush' },
  { brand: 'WHIRLPOOL CORP.', name: 'Whirlpool dryer', model: 'WED5620HW', serial: 'C92814553', note: 'Vent yearly' },
];

export interface AddOn {
  id: string;
  name: string;
  sub: string;
  base: number;
}

export const ADD_ONS: AddOn[] = [
  { id: 'lawn', name: 'Lawn care', sub: 'Weekly mow, edge and blow', base: 65 },
  { id: 'land', name: 'Landscaping', sub: 'Beds, mulch, seasonal color', base: 1400 },
  { id: 'win', name: 'Window washing', sub: 'Inside and out, screens', base: 420 },
  { id: 'press', name: 'Pressure washing', sub: 'Driveway, walks, siding', base: 340 },
  { id: 'lights', name: 'Holiday lights', sub: 'Roofline install and removal', base: 1150 },
  { id: 'tree', name: 'Tree service', sub: 'Trim, removal, stump grind', base: 780 },
];

/** Other network vendors that answer each request automatically in demo mode. */
export const OTHER_VENDORS = [
  { vendor: 'Summit Pro Services', rating: 4.8, m: 0.88, when: 'Sat, Oct 18' },
  { vendor: 'Clearview & Sons', rating: 4.7, m: 1.14, when: 'Mon, Oct 20' },
];

export const MY_VENDOR = { vendor: 'Evergreen Outdoor Co.', rating: 4.9 };

export const SLOTS: [string, string][] = [
  ['Tue · Oct 14', '9:00 – 11:00 AM'],
  ['Wed · Oct 15', '1:00 – 3:00 PM'],
  ['Fri · Oct 17', '8:00 – 10:00 AM'],
];

export const VENDOR_DATES = ['Thu, Oct 16', 'Sat, Oct 18', 'Tue, Oct 21'];

export const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

export const TECH = { name: 'Marcus Reyes', initials: 'MR', title: 'Senior technician · 4.9 · 212 visits', van: 'Silver Transit van · PHP-214' };

export const OTHER_JOBS = [
  { time: '12:00 – 2:00 PM', tier: 'Medium', name: 'David Okafor', addr: '4410 Bryn Mawr Dr' },
  { time: '3:00 – 5:00 PM', tier: 'High', name: 'The Whitfields', addr: '88 Beverly Dr' },
];

export const PHOTO_GRADIENTS: Record<string, [string, string]> = {
  dirty: ['#6f604a', '#4a4034'],
  clean: ['#c8d2dc', '#e8edf2'],
  drain: ['#9c8a6c', '#6d5d44'],
  ice: ['#b7c8dc', '#8fa6c0'],
};

export const WATER_OPTIONS = [
  { key: 'city_hard', label: 'City · hard' },
  { key: 'well', label: 'Well' },
  { key: 'softened', label: 'Softened' },
] as const;
