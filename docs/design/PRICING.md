# Tier pricing algorithm

One shared TypeScript module (`packages/pricing`). The same code runs in the office UI, the homeowner tier screen and the `build-plan` edge function.

## Inputs
- `rate`: labor $/hr billed. Default **94**.
- `trip`: trip fee per visit. Default **35**.
- `markup`: parts markup %. Default **25**.
- `techCost`: loaded tech cost $/hr. Default **38**. Used for margin only.
- `vehicleCostPerVisit`: default **12**. Margin only.
- Per task: `partCost` (AI-researched, lowest in-stock price among local and online suppliers), `laborMin`, and `freq[tier]` (times per year).
- Tiers: High = 12 visits/yr (manufacturer max), PHP Recommended = 6, Medium = 4, Low = 2.

## Home adjustments (applied before pricing)
- Pets = false: HVAC filter frequency is capped at 4/yr. (With pets, the default of 6/yr means every 60 days.)
- Water = well: water-heater flush −1/yr (min 1), plus a sediment check. Hard water keeps 2/yr.
- A task's frequency is capped at the tier's visit count (a task can't happen more often than we visit).
- Planned: sq-ft and HVAC zones set the filter count (the prototype shows ">3,000 sq ft → 2 returns").

## Formula (per tier)
```
f(t)     = min(adjustedFreq(t, tier), visits)
partsRaw = Σ f(t) · partCost(t)
materials= partsRaw · (1 + markup)
hours    = Σ f(t) · laborMin(t) / 60
labor    = hours · rate + visits · trip
annual   = materials + labor
monthly  = annual / 12
cost     = partsRaw + hours · techCost + visits · vehicleCostPerVisit
margin   = (annual − cost) / annual
```

## Default task table
| Task | Part | Cost | Min | High | Rec | Med | Low |
|---|---|---|---|---|---|---|---|
| HVAC filters ×2 | 16×25×4 MERV 11 ×2 | 76.80 | 20 | 6 | 6 | 4 | 2 |
| Fridge water filter | LG LT1000P | 49.97 | 10 | 2 | 2 | 2 | 1 |
| Ice maker drain & sanitize | Sanitizer kit | 8.50 | 25 | 4 | 2 | 2 | 1 |
| Dishwasher filter & sump | Affresh tablets | 4.20 | 15 | 12 | 6 | 4 | 2 |
| Water heater flush | Drain hose kit | 6.00 | 40 | 2 | 2 | 1 | 1 |
| Dryer vent | — | 0 | 30 | 2 | 1 | 1 | 0 |
| Smoke & CO test | 9V ×4 | 12.00 | 10 | 4 | 2 | 2 | 1 |

## Visit scheduling
Visits are spaced every `12 / visits` months, starting in the first available month. Task `t` is included in visit `k` when `(k · f) mod visits < f`. This spreads each task evenly across the year. The first visit always includes every active task, which serves as the baseline.

## Add-on brokerage
The homeowner pays the vendor's quoted price. PHP keeps a 10% coordination fee (configurable per vendor category). Collect up to 3 bids. A request closes on first booking.
