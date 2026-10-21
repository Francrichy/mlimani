/**
 * Flexible SaaS pricing
 * Modes per tier:
 *  - per_vehicle: amount = count * price_per_vehicle
 *  - flat: amount = price_tzs (fixed for that band)
 *  - base_plus: amount = price_tzs + (count - min_vehicles) * price_per_vehicle
 *
 * Default (editable by admin):
 *  Standard 1–30: 10,000 TZS per vehicle
 *  Enterprise 31+: 7,500 TZS per vehicle
 */
const { read, write } = require('./db');

function defaultTiers() {
  return [
    {
      id: 'standard',
      name: 'Standard',
      min_vehicles: 1,
      max_vehicles: 30,
      pricing_mode: 'per_vehicle',
      price_tzs: 0,
      price_per_vehicle: 10000,
      sort: 1,
      active: true
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      min_vehicles: 31,
      max_vehicles: 9999,
      pricing_mode: 'per_vehicle',
      price_tzs: 0,
      price_per_vehicle: 7500,
      sort: 2,
      active: true
    }
  ];
}

function getPricingTiers() {
  let tiers = read('pricing_tiers');
  // Migrate old flat-only tiers if empty or missing price_per_vehicle structure
  if (!tiers.length) {
    tiers = defaultTiers();
    write('pricing_tiers', tiers);
  }
  return tiers.filter(t => t.active !== false).sort((a, b) => a.sort - b.sort);
}

function priceForCount(count) {
  const n = Math.max(1, Number(count) || 1);
  const tiers = getPricingTiers();
  const tier = tiers.find(t => n >= t.min_vehicles && n <= t.max_vehicles);
  if (!tier) return { tier: null, amount: 0, breakdown: null };

  const mode = tier.pricing_mode || (tier.price_per_vehicle ? 'per_vehicle' : 'flat');
  let amount = 0;
  let breakdown = { mode, vehicles: n };

  if (mode === 'per_vehicle') {
    const rate = Number(tier.price_per_vehicle) || 0;
    amount = n * rate;
    breakdown.rate_per_vehicle = rate;
    breakdown.formula = `${n} × ${rate}`;
  } else if (mode === 'base_plus') {
    const base = Number(tier.price_tzs) || 0;
    const rate = Number(tier.price_per_vehicle) || 0;
    const extra = Math.max(0, n - (tier.min_vehicles || 1));
    amount = base + extra * rate;
    breakdown.base = base;
    breakdown.extra_vehicles = extra;
    breakdown.rate_per_vehicle = rate;
    breakdown.formula = `${base} + ${extra} × ${rate}`;
  } else {
    // flat band price
    amount = Number(tier.price_tzs) || 0;
    breakdown.flat = amount;
    breakdown.formula = `flat ${amount}`;
  }

  return { tier, amount, breakdown };
}

module.exports = { getPricingTiers, priceForCount, defaultTiers };
