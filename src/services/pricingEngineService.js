/**
 * Pricing engine extracted as a standalone service.
 * Used by the autonomous lead pipeline to auto-generate quotes.
 * All functions are pure — no DOM, no React.
 */

export const EXCHANGE_RATE_DEFAULT = 95.88;
export const TARGET_MARGIN_DEFAULT = 20;
export const MINIMUM_MARGIN_DEFAULT = 12;

const COST_SEED = [
  ['raw_material_cost', 'Raw Material'],
  ['packaging_cost', 'Packaging'],
  ['processing_cost', 'Processing'],
  ['labor_cost', 'Labor'],
  ['overhead_cost', 'Overhead'],
  ['inland_logistics_cost', 'Inland Logistics'],
  ['export_clearance_cost', 'Export Clearance'],
  ['cha_charges_cost', 'CHA Charges'],
  ['documentation_charges_cost', 'Documentation Charges'],
  ['port_charges_cost', 'Port Charges'],
  ['freight_cost', 'Freight'],
  ['insurance_cost', 'Insurance'],
  ['commission_cost', 'Commission'],
  ['misc_cost', 'Miscellaneous']
];

const COMMERCIAL_PRESETS = {
  pepper:    { baseInrPerKg: 708,    packagingInrPerKg: 10.5, processingInrPerKg: 15,   laborInrPerKg: 4.8, overheadInrPerKg: 6.5,  packing: '25 KG moisture-protected bags',        category: 'Spice Board product' },
  cardamom:  { baseInrPerKg: 2419.4, packagingInrPerKg: 14,   processingInrPerKg: 22,   laborInrPerKg: 6.5, overheadInrPerKg: 10,   packing: 'Vacuum / premium cartons',             category: 'Spice Board product' },
  cinnamon:  { baseInrPerKg: 320,    packagingInrPerKg: 9,    processingInrPerKg: 12,   laborInrPerKg: 4,   overheadInrPerKg: 6,    packing: '25 KG PP bags',                        category: 'Spice Board product' },
  clove:     { baseInrPerKg: 810,    packagingInrPerKg: 11,   processingInrPerKg: 16,   laborInrPerKg: 5,   overheadInrPerKg: 7.5,  packing: '25 KG moisture-protected bags',        category: 'Spice Board product' },
  coriander: { baseInrPerKg: 85,     packagingInrPerKg: 7,    processingInrPerKg: 9,    laborInrPerKg: 3,   overheadInrPerKg: 4.5,  packing: '25/50 KG PP bags',                     category: 'Spice Board product' },
  cumin:     { baseInrPerKg: 230,    packagingInrPerKg: 8,    processingInrPerKg: 11,   laborInrPerKg: 3.5, overheadInrPerKg: 5,    packing: '25 KG PP bags',                        category: 'Spice Board product' },
  turmeric:  { baseInrPerKg: 132.22, packagingInrPerKg: 8.5,  processingInrPerKg: 12,   laborInrPerKg: 3.8, overheadInrPerKg: 5.5,  packing: '25 KG PP bags or retail master cartons', category: 'Spice Board / APEDA product' },
  chilli:    { baseInrPerKg: 180,    packagingInrPerKg: 9.5,  processingInrPerKg: 13.5, laborInrPerKg: 4.2, overheadInrPerKg: 6,    packing: '10 KG cartons or 25 KG PP bags',       category: 'Spice Board product' },
  rice:      { baseInrPerKg: 68,     packagingInrPerKg: 6,    processingInrPerKg: 7,    laborInrPerKg: 2.5, overheadInrPerKg: 4,    packing: '25/50 KG woven export bags',           category: 'APEDA product' },
  onion:     { baseInrPerKg: 25,     packagingInrPerKg: 4,    processingInrPerKg: 5,    laborInrPerKg: 2,   overheadInrPerKg: 3,    packing: '25/50 KG mesh bags',                   category: 'APEDA product' },
  garlic:    { baseInrPerKg: 30,     packagingInrPerKg: 4.5,  processingInrPerKg: 5.5,  laborInrPerKg: 2.2, overheadInrPerKg: 3.5,  packing: '10/25 KG mesh bags',                   category: 'APEDA product' },
  default:   { baseInrPerKg: 115,    packagingInrPerKg: 8,    processingInrPerKg: 9,    laborInrPerKg: 3,   overheadInrPerKg: 4.5,  packing: 'Buyer-specific export packing',         category: 'Export product' }
};

const FREIGHT_PROFILES = {
  Australia:        { seaInrPerKg: 15,   airInrPerKg: 245, complexity: 1.45, lead: '18–32 days by sea' },
  Canada:           { seaInrPerKg: 17,   airInrPerKg: 260, complexity: 1.55, lead: '25–42 days by sea' },
  Germany:          { seaInrPerKg: 14,   airInrPerKg: 230, complexity: 1.38, lead: '22–36 days by sea' },
  Japan:            { seaInrPerKg: 12,   airInrPerKg: 220, complexity: 1.28, lead: '18–30 days by sea' },
  'Saudi Arabia':   { seaInrPerKg: 7.5,  airInrPerKg: 165, complexity: 1.1,  lead: '10–20 days by sea' },
  Singapore:        { seaInrPerKg: 8.5,  airInrPerKg: 155, complexity: 1.05, lead: '8–18 days by sea' },
  'United Arab Emirates': { seaInrPerKg: 6.5, airInrPerKg: 150, complexity: 1, lead: '7–16 days by sea' },
  'United Kingdom': { seaInrPerKg: 15.5, airInrPerKg: 245, complexity: 1.48, lead: '24–40 days by sea' },
  'United States':  { seaInrPerKg: 18,   airInrPerKg: 275, complexity: 1.60, lead: '28–45 days by sea' },
};

export function moneyNumber(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function clampPercent(v) {
  const n = moneyNumber(v);
  return Math.max(0, Math.min(n, 99.99));
}

export function convertCurrency(amount, from, to, usdToInrRate = EXCHANGE_RATE_DEFAULT) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (from === to) return amount;
  const rate = usdToInrRate > 0 ? usdToInrRate : EXCHANGE_RATE_DEFAULT;
  const map = { INR: 1, USD: rate, AED: rate / 3.6725, SAR: rate / 3.75, EUR: rate * 1.08, GBP: rate * 1.27, AUD: rate * 0.66, SGD: rate * 0.74 };
  return (amount * (map[String(from).toUpperCase()] || rate)) / (map[String(to).toUpperCase()] || rate);
}

function productKey(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('pepper') || n.includes('black pepper')) return 'pepper';
  if (n.includes('cardamom')) return 'cardamom';
  if (n.includes('cinnamon')) return 'cinnamon';
  if (n.includes('clove')) return 'clove';
  if (n.includes('coriander')) return 'coriander';
  if (n.includes('cumin') || n.includes('jeera')) return 'cumin';
  if (n.includes('turmeric') || n.includes('haldi')) return 'turmeric';
  if (n.includes('chilli') || n.includes('chili') || n.includes('red chilli')) return 'chilli';
  if (n.includes('rice') || n.includes('basmati')) return 'rice';
  if (n.includes('onion')) return 'onion';
  if (n.includes('garlic')) return 'garlic';
  return 'default';
}

function getFreightProfile(country) {
  return FREIGHT_PROFILES[country] || { seaInrPerKg: 12, airInrPerKg: 215, complexity: 1.25, lead: '10–35 days' };
}

function getPreset(productName) {
  return COMMERCIAL_PRESETS[productKey(productName)] || COMMERCIAL_PRESETS.default;
}

export function parsedQuantity(quantity, unit) {
  const value = moneyNumber(quantity);
  const normalized = String(unit || '').toLowerCase();
  let kg = value * 1000;
  if (normalized === 'kg') kg = value;
  else if (['mt', 'ton', 'tons', 'metric ton'].includes(normalized)) kg = value * 1000;
  else if (normalized === 'bags') kg = value * 25;
  else if (normalized === 'cartons') kg = value * 10;
  return { value, unit, kg, tons: kg / 1000 };
}

function incotermKeys(incoterm) {
  const s = new Set(['raw_material_cost', 'packaging_cost', 'processing_cost', 'labor_cost', 'overhead_cost', 'commission_cost']);
  if (['FOB', 'CFR', 'CIF', 'DAP', 'DDP'].includes(incoterm)) {
    ['inland_logistics_cost', 'export_clearance_cost', 'cha_charges_cost', 'documentation_charges_cost', 'port_charges_cost'].forEach(k => s.add(k));
  }
  if (['CFR', 'CIF', 'DAP', 'DDP'].includes(incoterm)) s.add('freight_cost');
  if (['CIF', 'DAP', 'DDP'].includes(incoterm)) s.add('insurance_cost');
  return s;
}

/**
 * Run the pricing engine for a lead and return a full quote result.
 *
 * @param {object} lead - { product, quantity, unit_of_measure?, destination_country, incoterm?, shipping_mode?, currency?, exchange_rate?, target_margin?, min_margin? }
 * @returns {object} pricingResult
 */
export function runPricingEngine(lead) {
  const product = lead.product || lead.product_name || 'Unknown';
  const incoterm = (lead.incoterm || 'FOB').toUpperCase();
  const country = lead.destination_country || '';
  const shipping = lead.shipping_mode || 'Sea freight';
  const quoteCurrency = (lead.currency || 'USD').toUpperCase();
  const exRate = moneyNumber(lead.exchange_rate) || EXCHANGE_RATE_DEFAULT;
  const targetMargin = clampPercent(lead.target_margin || lead.target_margin_percent || TARGET_MARGIN_DEFAULT);
  const minMargin = clampPercent(lead.min_margin || lead.minimum_margin_percent || MINIMUM_MARGIN_DEFAULT);

  const qty = parsedQuantity(lead.quantity, lead.unit_of_measure || 'mt');
  const kg = Math.max(qty.kg, 1);
  const preset = getPreset(product);
  const freight = getFreightProfile(country);
  const included = incotermKeys(incoterm);
  const isAir = String(shipping).toLowerCase().includes('air');
  const modeMultiplier = isAir ? 1.28 : 1;
  const toQuote = (inr) => roundMoney(convertCurrency(inr, 'INR', quoteCurrency, exRate));

  const estimates = {
    raw_material_cost:          { amount: toQuote(preset.baseInrPerKg),           basis: 'PER_KG' },
    packaging_cost:             { amount: toQuote(preset.packagingInrPerKg),       basis: 'PER_KG' },
    processing_cost:            { amount: toQuote(preset.processingInrPerKg),      basis: 'PER_KG' },
    labor_cost:                 { amount: toQuote(preset.laborInrPerKg),           basis: 'PER_KG' },
    overhead_cost:              { amount: toQuote(preset.overheadInrPerKg),        basis: 'PER_KG' },
    inland_logistics_cost:      { amount: toQuote(roundMoney((52000 + kg * 1.65) * freight.complexity * (isAir ? 0.72 : 1))), basis: 'PER_ORDER' },
    export_clearance_cost:      { amount: toQuote(roundMoney(18500 * freight.complexity)), basis: 'PER_ORDER' },
    cha_charges_cost:           { amount: toQuote(roundMoney(13500 * freight.complexity)), basis: 'PER_ORDER' },
    documentation_charges_cost: { amount: toQuote(roundMoney(6500 * freight.complexity)),  basis: 'PER_ORDER' },
    port_charges_cost:          { amount: toQuote(roundMoney((isAir ? 16500 : 36500) * freight.complexity)), basis: 'PER_ORDER' },
    freight_cost:               { amount: toQuote(roundMoney(kg * (isAir ? freight.airInrPerKg : freight.seaInrPerKg) * modeMultiplier)), basis: 'PER_ORDER' },
    insurance_cost:             { amount: 0.35, basis: 'PERCENT_INVOICE_VALUE' },
    commission_cost:            { amount: 2.5,  basis: 'PERCENT_INVOICE_VALUE' },
    misc_cost:                  { amount: toQuote(roundMoney(Math.max(8500, kg * 0.75))), basis: 'PER_ORDER' }
  };

  // Build cost lines
  const lines = COST_SEED.map(([key, label]) => {
    const est = estimates[key];
    const isIncluded = included.has(key);
    let lineTotal = 0;
    if (isIncluded && est.basis !== 'PERCENT_INVOICE_VALUE') {
      lineTotal = est.basis === 'PER_KG' ? roundMoney(est.amount * kg) : est.amount;
    }
    return { key, label, amount: est.amount, basis: est.basis, included: isIncluded, lineTotal };
  });

  // Non-percent subtotal
  const subtotal = lines.filter(l => l.included && l.basis !== 'PERCENT_INVOICE_VALUE').reduce((s, l) => s + l.lineTotal, 0);

  // Percent lines
  lines.forEach(l => {
    if (l.included && l.basis === 'PERCENT_INVOICE_VALUE') {
      l.lineTotal = roundMoney(subtotal * l.amount / 100);
    }
  });

  const totalCost = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const targetTotalPrice = roundMoney(totalCost / (1 - targetMargin / 100));
  const minTotalPrice = roundMoney(totalCost / (1 - minMargin / 100));
  const safeTotalPrice = roundMoney(totalCost / (1 - 24 / 100));
  const recommended = Math.max(targetTotalPrice, minTotalPrice);
  const profit = roundMoney(recommended - totalCost);
  const qtyValue = qty.value || 1;

  return {
    product,
    quantity: qty,
    incoterm,
    destination: country,
    currency: quoteCurrency,
    exchangeRate: exRate,
    shippingMode: shipping,
    seaLeadTime: freight.lead,
    packingSuggestion: preset.packing,
    productCategory: preset.category,
    lines,
    totalCost,
    costPerUnit: roundMoney(totalCost / qtyValue),
    costPerKg: roundMoney(totalCost / kg),
    targetMargin,
    minMargin,
    minPricePerUnit: roundMoney(minTotalPrice / qtyValue),
    targetPricePerUnit: roundMoney(targetTotalPrice / qtyValue),
    safePricePerUnit: roundMoney(safeTotalPrice / qtyValue),
    recommendedTotalPrice: recommended,
    recommendedPricePerUnit: roundMoney(recommended / qtyValue),
    profitAmount: profit,
    achievedMarginPercent: recommended > 0 ? roundMoney((profit / recommended) * 100) : 0
  };
}
