-- Defaults from PRICING.md (mirrors packages/pricing DEFAULT_* constants).
insert into pricing_settings (id) values (1) on conflict do nothing;

insert into task_defaults (task_key, name, labor_min, freq_high, freq_recommended, freq_medium, freq_low) values
  ('hvac',   'Replace HVAC filters ×2',        20,  6, 6, 4, 2),
  ('fridge', 'Replace fridge water filter',    10,  2, 2, 2, 1),
  ('ice',    'Drain & sanitize ice maker',     25,  4, 2, 2, 1),
  ('dish',   'Clean dishwasher filter & sump', 15, 12, 6, 4, 2),
  ('wh',     'Flush water heater',             40,  2, 2, 1, 1),
  ('dryer',  'Clean dryer vent',               30,  2, 1, 1, 0),
  ('smoke',  'Test smoke & CO detectors',      10,  4, 2, 2, 1)
on conflict (task_key) do nothing;

insert into parts (part_number, description) values
  ('16x25x4-MERV11', '16×25×4 MERV 11 filter'),
  ('LT1000P', 'LG fridge water filter'),
  ('ICE-SANI', 'Ice maker sanitizer kit'),
  ('AFFRESH-DW', 'Affresh dishwasher tablets'),
  ('WH-DRAIN', 'Water heater drain hose kit'),
  ('9V', '9V battery')
on conflict (part_number) do nothing;
