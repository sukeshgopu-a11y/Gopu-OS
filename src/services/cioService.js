import { requireSupabase, backendStatus } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';
import { writeAgentMemory, queryAgentMemory } from './agentMemoryService.js';
import { runPricingEngine } from './pricingEngineService.js';

const HIGH_VALUE_COUNTRIES = ['Australia', 'UAE', 'Saudi Arabia', 'Singapore', 'UK', 'USA', 'Germany'];

export function scoreLead(lead) {
  const reasons = [];
  let score = 5;

  const qty = Number(lead?.quantity_mt || lead?.quantity || 0);
  if (qty >= 20) { score += 2; reasons.push('Large quantity (≥20 MT)'); }
  else if (qty >= 10) { score += 1; reasons.push('Medium quantity (≥10 MT)'); }

  if (lead?.email || lead?.buyer_email) { score += 1; reasons.push('Email provided'); }

  const terms = (lead?.payment_terms || '').toLowerCase();
  if (terms.includes('advance') || terms.includes('tt in advance')) {
    score += 1;
    reasons.push('Favorable payment terms');
  }

  const country = lead?.destination_country || lead?.country || '';
  if (HIGH_VALUE_COUNTRIES.some(c => c.toLowerCase() === country.toLowerCase())) {
    score += 1;
    reasons.push(`High-value market: ${country}`);
  }

  score = Math.max(0, Math.min(10, score));
  const tier = score >= 8 ? 'A' : score >= 6 ? 'B' : 'C';

  return { score, tier, reasons };
}

export async function getCIOSummary(tenantId = demoTenantId) {
  const empty = {
    totalLeads: 0, aLeads: 0, bLeads: 0, cLeads: 0,
    conversionRate: 0, topProduct: null, topDestination: null, averageLeadScore: 0,
  };

  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: empty, backend: backendStatus };

  try {
    const { data, error: qErr } = await client
      .from('lead_intake')
      .select('*')
      .eq('tenant_id', tenantId)
      .catch(() => ({ data: null, error: true }));

    if (qErr || !data || data.length === 0) return { ok: true, data: empty, backend: backendStatus };

    const scored = data.map(l => ({ ...l, ...scoreLead(l) }));
    const aLeads = scored.filter(l => l.tier === 'A').length;
    const bLeads = scored.filter(l => l.tier === 'B').length;
    const cLeads = scored.filter(l => l.tier === 'C').length;
    const won = data.filter(l => (l.status || '').toLowerCase() === 'won').length;
    const conversionRate = data.length > 0 ? Math.round((won / data.length) * 100) : 0;
    const averageLeadScore = scored.length > 0
      ? Math.round((scored.reduce((s, l) => s + l.score, 0) / scored.length) * 10) / 10
      : 0;

    const productCounts = {};
    const countryCounts = {};
    for (const l of data) {
      const p = l.product || l.product_name || 'Unknown';
      const c = l.destination_country || l.country || 'Unknown';
      productCounts[p] = (productCounts[p] || 0) + 1;
      countryCounts[c] = (countryCounts[c] || 0) + 1;
    }

    const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const topDestination = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      ok: true,
      data: { totalLeads: data.length, aLeads, bLeads, cLeads, conversionRate, topProduct, topDestination, averageLeadScore },
      backend: backendStatus,
    };
  } catch {
    return { ok: true, data: empty, backend: backendStatus };
  }
}

export async function getLeadIntelligence(tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: [], backend: backendStatus };

  try {
    const { data, error: qErr } = await client
      .from('lead_intake')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .catch(() => ({ data: null, error: true }));

    if (qErr || !data) return { ok: true, data: [], backend: backendStatus };

    const enriched = data.map(lead => ({ ...lead, ...scoreLead(lead) }));
    return { ok: true, data: enriched, backend: backendStatus };
  } catch {
    return { ok: true, data: [], backend: backendStatus };
  }
}

export async function getBuyerIntelligence(buyerName, tenantId = demoTenantId) {
  const empty = { buyerName, totalOrders: 0, averageOrderValue: 0, preferredProducts: [], riskAssessment: 'Unknown', history: [] };

  if (!buyerName) return { ok: true, data: empty, backend: backendStatus };

  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: empty, backend: backendStatus };

  try {
    const { data, error: qErr } = await client
      .from('lead_intake')
      .select('*')
      .eq('tenant_id', tenantId)
      .ilike('buyer_name', `%${buyerName}%`)
      .catch(() => ({ data: null, error: true }));

    if (qErr || !data || data.length === 0) return { ok: true, data: empty, backend: backendStatus };

    const totalOrders = data.length;
    const values = data.map(l => Number(l.total_value || l.quoted_price || 0)).filter(Boolean);
    const averageOrderValue = values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;

    const productCounts = {};
    for (const l of data) {
      const p = l.product || l.product_name || 'Unknown';
      productCounts[p] = (productCounts[p] || 0) + 1;
    }
    const preferredProducts = Object.entries(productCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([product, count]) => ({ product, count }));

    const wonCount = data.filter(l => (l.status || '').toLowerCase() === 'won').length;
    const winRate = totalOrders > 0 ? wonCount / totalOrders : 0;
    const riskAssessment = winRate >= 0.5 ? 'Low' : winRate >= 0.25 ? 'Medium' : 'High';

    return {
      ok: true,
      data: { buyerName, totalOrders, averageOrderValue, preferredProducts, riskAssessment, history: data },
      backend: backendStatus,
    };
  } catch {
    return { ok: true, data: empty, backend: backendStatus };
  }
}

export async function getMarketOpportunities(tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: [], backend: backendStatus };

  try {
    const { data, error: qErr } = await client
      .from('lead_intake')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('status', ['Won', 'won', 'Closed Won'])
      .catch(() => ({ data: null, error: true }));

    if (qErr || !data || data.length === 0) return { ok: true, data: [], backend: backendStatus };

    const matrix = {};
    for (const l of data) {
      const country = l.destination_country || l.country || 'Unknown';
      const product = l.product || l.product_name || 'Unknown';
      const key = `${country}::${product}`;
      if (!matrix[key]) matrix[key] = { country, product, volume: 0, count: 0 };
      matrix[key].volume += Number(l.quantity_mt || l.quantity || 0);
      matrix[key].count += 1;
    }

    const opportunities = Object.values(matrix)
      .sort((a, b) => b.count - a.count)
      .map(o => ({
        country: o.country,
        product: o.product,
        volume: o.volume,
        trend: o.count >= 3 ? 'Growing' : o.count >= 2 ? 'Stable' : 'Emerging',
        recommendation: `Focus on ${o.product} exports to ${o.country} (${o.count} won deals)`,
      }));

    return { ok: true, data: opportunities, backend: backendStatus };
  } catch {
    return { ok: true, data: [], backend: backendStatus };
  }
}

export async function getWeeklyIntelligenceReport(tenantId = demoTenantId) {
  const [summary, opportunities] = await Promise.all([
    getCIOSummary(tenantId),
    getMarketOpportunities(tenantId),
  ]);

  const s = summary.data;
  const ops = opportunities.data.slice(0, 3);

  const lines = [
    `Weekly Intelligence Report`,
    `──────────────────────────`,
    `Total Leads: ${s.totalLeads} | A: ${s.aLeads} | B: ${s.bLeads} | C: ${s.cLeads}`,
    `Conversion Rate: ${s.conversionRate}% | Avg Lead Score: ${s.averageLeadScore}`,
    s.topProduct ? `Top Product: ${s.topProduct}` : null,
    s.topDestination ? `Top Destination: ${s.topDestination}` : null,
    ops.length > 0 ? `\nTop Opportunities:` : null,
    ...ops.map((o, i) => `  ${i + 1}. ${o.recommendation}`),
  ].filter(Boolean);

  return { ok: true, data: { report: lines.join('\n'), generatedAt: new Date().toISOString() }, backend: backendStatus };
}

export async function getCIODashboard(tenantId = demoTenantId) {
  const [summary, leads, opportunities, weeklyReport] = await Promise.all([
    getCIOSummary(tenantId),
    getLeadIntelligence(tenantId),
    getMarketOpportunities(tenantId),
    getWeeklyIntelligenceReport(tenantId),
  ]);

  return {
    ok: true,
    data: {
      summary: summary.data,
      leads: leads.data,
      opportunities: opportunities.data,
      weeklyReport: weeklyReport.data,
    },
    backend: backendStatus,
  };
}

export function getCIOKnowledgeBase() {
  return {
    role: 'Chief Intelligence Officer',
    mandate: 'No lead enters without a score. No market moves without CIO knowing first.',
    leadScoringCriteria: {
      baseScore: 5,
      bonuses: [
        { condition: 'Quantity ≥ 20 MT', points: 2 },
        { condition: 'Quantity ≥ 10 MT', points: 1 },
        { condition: 'Email provided', points: 1 },
        { condition: 'Payment terms: Advance / TT in Advance', points: 1 },
        { condition: 'Destination: Australia, UAE, Saudi Arabia, Singapore, UK, USA, Germany', points: 1 },
      ],
      tiers: { A: '≥8 — High priority, fast-track to Founder approval', B: '6–7 — Standard pipeline', C: '<6 — Nurture or deprioritise' },
    },
    marketIntelligenceSources: [
      'APEDA export statistics (apeda.gov.in)',
      'Spice Board price bulletins (indianspices.com)',
      'Ministry of Commerce trade data (tradestat.commerce.gov.in)',
      'Own pipeline win/loss data from lead_intake table',
    ],
    buyerSignals: {
      highValue: ['Large quantity order', 'Advance payment terms', 'Known import market', 'Responds within 24h', 'Has company email'],
      lowValue: ['No email', 'Unknown destination', 'Vague quantity', 'No payment terms specified'],
    },
    kpis: ['Lead conversion rate by tier', 'Average lead score', 'Top destination trends', 'Win rate by product/country', 'Time to first quote'],
  };
}
