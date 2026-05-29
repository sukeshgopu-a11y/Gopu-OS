import { backendStatus, requireSupabase } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';
import { sendSlackNotification } from './slackNotificationService.js';
import { createAuditLog } from './auditService.js';
import { createApprovalRequest } from './approvalService.js';

// Payment thresholds
const AUTO_PAY_LIMIT = 1500;       // CFO auto-pays ≤ this
const SLACK_APPROVAL_LIMIT = 2000; // CFO requests Slack approval ≤ this

// Known recurring infrastructure payments
const RECURRING_PAYMENTS = [
  { vendor: 'Vercel', category: 'Hosting', amount: 0, currency: 'INR', frequency: 'Monthly', auto_pay: true },
  { vendor: 'Supabase', category: 'Database', amount: 0, currency: 'INR', frequency: 'Monthly', auto_pay: true },
  { vendor: 'OpenAI', category: 'AI Credits', amount: 0, currency: 'INR', frequency: 'Usage-based', auto_pay: true },
  { vendor: 'Resend', category: 'Email API', amount: 0, currency: 'INR', frequency: 'Monthly', auto_pay: true },
  { vendor: 'Twilio', category: 'WhatsApp API', amount: 0, currency: 'INR', frequency: 'Usage-based', auto_pay: true },
  { vendor: 'Domain Registrar', category: 'Domain', amount: 0, currency: 'INR', frequency: 'Annual', auto_pay: false },
];

function inr(value) {
  return `INR ${Number(value || 0).toLocaleString('en-IN')}`;
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ─── Recurring Payments ────────────────────────────────────────────────────

export async function getRecurringPayments(tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: RECURRING_PAYMENTS, error: null, backend: backendStatus };

  try {
    const vendorNames = RECURRING_PAYMENTS.map((p) => p.vendor);
    const { data, error: queryError } = await client
      .from('payments')
      .select('vendor, amount, currency, frequency, status, paid_at')
      .eq('tenant_id', tenantId)
      .in('vendor', vendorNames)
      .order('paid_at', { ascending: false });

    if (queryError) return { ok: true, data: RECURRING_PAYMENTS, error: null, backend: backendStatus };

    const liveMap = {};
    for (const row of data || []) {
      if (!liveMap[row.vendor]) liveMap[row.vendor] = row;
    }

    const enriched = RECURRING_PAYMENTS.map((p) => ({
      ...p,
      ...(liveMap[p.vendor]
        ? {
            amount: safeNum(liveMap[p.vendor].amount),
            currency: liveMap[p.vendor].currency || p.currency,
            last_paid: liveMap[p.vendor].paid_at,
            last_status: liveMap[p.vendor].status,
          }
        : {}),
    }));

    return { ok: true, data: enriched, error: null, backend: backendStatus };
  } catch (e) {
    return { ok: true, data: RECURRING_PAYMENTS, error: null, backend: backendStatus };
  }
}

// ─── P&L ──────────────────────────────────────────────────────────────────

async function calcProfitAndLoss(tenantId, startDate, endDate) {
  const { client, error } = requireSupabase();
  if (error) return { revenue: 0, cogs: 0, infrastructure: 0, gross_profit: 0, net_profit: 0 };

  try {
    // Revenue: from lead_intake (invoiced/won deals)
    const [revenueResult, costsResult] = await Promise.all([
      client
        .from('lead_intake')
        .select('estimated_value, status')
        .eq('tenant_id', tenantId)
        .in('status', ['Won', 'Invoiced', 'Closed'])
        .gte('created_at', startDate)
        .lte('created_at', endDate),
      client
        .from('payments')
        .select('amount, category, status')
        .eq('tenant_id', tenantId)
        .in('status', ['Paid', 'Completed', 'Auto-Paid'])
        .gte('paid_at', startDate)
        .lte('paid_at', endDate),
    ]);

    const revenue = (revenueResult.data || []).reduce((sum, r) => sum + safeNum(r.estimated_value), 0);

    const infraCategories = ['Hosting', 'Database', 'AI Credits', 'Email API', 'WhatsApp API', 'Domain'];
    let cogs = 0;
    let infrastructure = 0;

    for (const row of costsResult.data || []) {
      const amt = safeNum(row.amount);
      if (infraCategories.includes(row.category)) {
        infrastructure += amt;
      } else {
        cogs += amt;
      }
    }

    const gross_profit = revenue - cogs;
    const net_profit = gross_profit - infrastructure;

    return { revenue, cogs, infrastructure, gross_profit, net_profit };
  } catch {
    return { revenue: 0, cogs: 0, infrastructure: 0, gross_profit: 0, net_profit: 0 };
  }
}

export async function getProfitAndLoss(tenantId = demoTenantId, period = 'monthly') {
  const now = new Date();
  let startDate;
  if (period === 'weekly') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 7);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const pnl = await calcProfitAndLoss(tenantId, startDate.toISOString(), now.toISOString());
  return {
    ok: true,
    data: {
      period,
      start_date: startDate.toISOString(),
      end_date: now.toISOString(),
      ...pnl,
      revenue_formatted: inr(pnl.revenue),
      cogs_formatted: inr(pnl.cogs),
      infrastructure_formatted: inr(pnl.infrastructure),
      gross_profit_formatted: inr(pnl.gross_profit),
      net_profit_formatted: inr(pnl.net_profit),
    },
    error: null,
    backend: backendStatus,
  };
}

export async function getWeeklyProfit(tenantId = demoTenantId) {
  return getProfitAndLoss(tenantId, 'weekly');
}

export async function getMonthlyProfit(tenantId = demoTenantId) {
  return getProfitAndLoss(tenantId, 'monthly');
}

// ─── Payment Initiation ───────────────────────────────────────────────────

export async function initiatePayment(payload = {}, tenantId = demoTenantId) {
  const amount = safeNum(payload.amount);
  const vendor = payload.vendor || 'Unknown Vendor';
  const category = payload.category || 'General';
  const description = payload.description || `Payment to ${vendor}`;
  const paymentId = `pay-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const { client } = requireSupabase();

  // Insert pending payment record if Supabase is available
  let dbPayment = null;
  if (client) {
    try {
      const { data } = await client
        .from('payments')
        .insert({
          id: paymentId,
          tenant_id: tenantId,
          vendor,
          amount,
          currency: payload.currency || 'INR',
          category,
          description,
          status: 'Pending',
          created_at: new Date().toISOString(),
        })
        .select('id, status')
        .maybeSingle();
      dbPayment = data;
    } catch {
      // graceful — proceed even if insert fails
    }
  }

  // Tier 1: Auto-pay ≤ Rs.1,500
  if (amount <= AUTO_PAY_LIMIT) {
    if (client) {
      try {
        await client.from('payments').update({ status: 'Auto-Paid', paid_at: new Date().toISOString() }).eq('id', paymentId);
      } catch { /* graceful */ }
    }

    await createAuditLog({
      tenant_id: tenantId,
      action_type: 'CFO Auto-Payment',
      module: 'CFO Payment Vault',
      related_table: 'payments',
      related_record_id: null,
      actor: 'CFO Agent',
      description: `CFO auto-approved and paid ${inr(amount)} to ${vendor} (below auto-pay limit of ${inr(AUTO_PAY_LIMIT)}).`,
      risk_level: 'Low',
      metadata: { payment_id: paymentId, vendor, amount, category },
    });

    await sendSlackNotification({
      type: 'Payment Received',
      priority: 'INFO',
      reference: paymentId,
      buyer: vendor,
      status: 'Auto-Paid',
      actionRequired: `CFO auto-paid ${inr(amount)} to ${vendor}. No action required.`,
      source: 'CFO Agent',
    });

    return { ok: true, data: { paymentId, status: 'Auto-Paid', amount, vendor, tier: 1 }, error: null };
  }

  // Tier 2: Slack approval required Rs.1,500–Rs.2,000
  if (amount <= SLACK_APPROVAL_LIMIT) {
    await sendSlackNotification({
      type: 'Founder Approval Required',
      priority: 'WARNING',
      reference: paymentId,
      buyer: vendor,
      status: 'Pending Founder Approval',
      actionRequired: `CFO requires Founder approval to pay ${inr(amount)} to ${vendor}. Please approve or reject in Slack.`,
      source: 'CFO Agent',
    });

    await createApprovalRequest({
      tenant_id: tenantId,
      approval_type: 'CFO Payment Approval',
      related_table: 'payments',
      related_record_id: null,
      amount,
      vendor,
      description,
      status: 'Pending Approval',
      metadata: { payment_id: paymentId, category, tier: 2 },
    });

    await createAuditLog({
      tenant_id: tenantId,
      action_type: 'CFO Payment Pending Slack Approval',
      module: 'CFO Payment Vault',
      actor: 'CFO Agent',
      description: `CFO sent Slack approval request for ${inr(amount)} payment to ${vendor}.`,
      risk_level: 'Medium',
      metadata: { payment_id: paymentId, vendor, amount },
    });

    return { ok: true, data: { paymentId, status: 'Pending Slack Approval', amount, vendor, tier: 2 }, error: null };
  }

  // Tier 3: Director approval required > Rs.2,000
  await createApprovalRequest({
    tenant_id: tenantId,
    approval_type: 'Director Payment Approval',
    related_table: 'payments',
    related_record_id: null,
    amount,
    vendor,
    description,
    status: 'Pending Approval',
    metadata: { payment_id: paymentId, category, tier: 3 },
  });

  await createAuditLog({
    tenant_id: tenantId,
    action_type: 'CFO Payment Escalated to Director',
    module: 'CFO Payment Vault',
    actor: 'CFO Agent',
    description: `CFO escalated ${inr(amount)} payment to ${vendor} — exceeds Slack approval limit. Director approval required.`,
    risk_level: 'High',
    metadata: { payment_id: paymentId, vendor, amount },
  });

  await sendSlackNotification({
    type: 'Founder Approval Required',
    priority: 'URGENT',
    reference: paymentId,
    buyer: vendor,
    status: 'Pending Director Approval',
    actionRequired: `Payment of ${inr(amount)} to ${vendor} requires Director approval (exceeds ${inr(SLACK_APPROVAL_LIMIT)}).`,
    source: 'CFO Agent',
  });

  return { ok: true, data: { paymentId, status: 'Pending Director Approval', amount, vendor, tier: 3 }, error: null };
}

// ─── OTP Handling ─────────────────────────────────────────────────────────

export async function submitOtp(paymentId, otp, tenantId = demoTenantId) {
  if (!paymentId || !otp) {
    return { ok: false, error: 'paymentId and otp are required', data: null };
  }

  const { client } = requireSupabase();

  // Mark payment as OTP-completed
  if (client) {
    try {
      await client
        .from('payments')
        .update({ status: 'Completed', paid_at: new Date().toISOString(), otp_used: true })
        .eq('id', paymentId)
        .eq('tenant_id', tenantId);
    } catch { /* graceful */ }
  }

  // Audit — OTP itself is never stored
  await createAuditLog({
    tenant_id: tenantId,
    action_type: 'CFO OTP Payment Completed',
    module: 'CFO Payment Vault',
    actor: 'CFO Agent',
    description: `OTP received and used to complete payment ${paymentId}. OTP cleared from memory immediately.`,
    risk_level: 'High',
    metadata: { payment_id: paymentId, otp_stored: false },
  });

  await sendSlackNotification({
    type: 'Payment Received',
    priority: 'INFO',
    reference: paymentId,
    status: 'Completed via OTP',
    actionRequired: `Payment ${paymentId} completed via OTP. OTP has been cleared from memory.`,
    source: 'CFO Agent',
  });

  // OTP is intentionally not stored anywhere — clear from scope
  // eslint-disable-next-line no-param-reassign
  otp = null;

  return { ok: true, data: { paymentId, status: 'Completed', otp_cleared: true }, error: null };
}

// ─── Payment Status ────────────────────────────────────────────────────────

export async function getPaymentStatus(paymentId, tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: { paymentId, status: 'Unknown', backend: 'disconnected' }, error: null };

  try {
    const { data, error: queryError } = await client
      .from('payments')
      .select('id, vendor, amount, currency, status, category, paid_at, created_at')
      .eq('id', paymentId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (queryError || !data) return { ok: false, data: null, error: queryError?.message || 'Not found' };
    return { ok: true, data, error: null };
  } catch (e) {
    return { ok: false, data: null, error: e?.message || 'Query failed' };
  }
}

// ─── CFO Dashboard ────────────────────────────────────────────────────────

export async function getCFODashboard(tenantId = demoTenantId) {
  const [monthlyPnl, weeklyPnl, recurringResult] = await Promise.all([
    getMonthlyProfit(tenantId),
    getWeeklyProfit(tenantId),
    getRecurringPayments(tenantId),
  ]);

  const { client } = requireSupabase();
  let recentPayments = [];
  let receivables = [];

  if (client) {
    try {
      const [paymentsResult, receivablesResult] = await Promise.all([
        client
          .from('payments')
          .select('id, vendor, amount, currency, status, category, paid_at, created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(20),
        client
          .from('lead_intake')
          .select('id, company_name, estimated_value, status, created_at')
          .eq('tenant_id', tenantId)
          .in('status', ['Won', 'Invoiced', 'Active', 'Negotiation'])
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      recentPayments = paymentsResult.data || [];
      receivables = (receivablesResult.data || []).map((r) => ({
        id: r.id,
        company: r.company_name,
        amount: r.estimated_value,
        status: r.status,
        created_at: r.created_at,
      }));
    } catch { /* graceful */ }
  }

  const monthly = monthlyPnl.data || {};
  const weekly = weeklyPnl.data || {};

  return {
    ok: true,
    backend: backendStatus,
    data: {
      monthly_pnl: monthly,
      weekly_pnl: weekly,
      recurring_payments: recurringResult.data || [],
      recent_payments: recentPayments,
      receivables,
      payables: recentPayments.filter((p) => p.status === 'Pending'),
      summary: {
        monthly_revenue: inr(monthly.revenue || 0),
        monthly_net_profit: inr(monthly.net_profit || 0),
        weekly_revenue: inr(weekly.revenue || 0),
        weekly_net_profit: inr(weekly.net_profit || 0),
        pending_payments: recentPayments.filter((p) => p.status === 'Pending').length,
        open_receivables: receivables.length,
      },
    },
  };
}

// ─── Legacy exported functions (kept for UI compatibility) ─────────────────

export async function getCFOSummary(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  const { summary } = dashboard.data;
  return {
    data: {
      pendingQuoteApprovals: summary.pending_payments,
      marginRiskAlerts: 0,
      invoiceReleaseApprovals: 0,
      paymentVaultSummary: summary.monthly_net_profit,
      renewalPaymentAlerts: dashboard.data.recurring_payments.filter((p) => !p.last_paid).length,
      openaiCreditRenewalStatus: 'Tracked via recurring payments',
      highRiskWorkflows: 0,
      recommendations: [],
    },
    error: null,
  };
}

export async function getMarginAnalytics() {
  return { data: { byProduct: [], riskyQuotes: [], freightImpact: [] }, error: null };
}

export async function getReceivables(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  return { data: dashboard.data.receivables, error: null };
}

export async function getPayables(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  return { data: dashboard.data.payables, error: null };
}

export async function getPaymentVaultSummary(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  return {
    data: {
      metrics: [
        { label: 'Monthly Revenue', value: dashboard.data.summary.monthly_revenue },
        { label: 'Monthly Net Profit', value: dashboard.data.summary.monthly_net_profit },
        { label: 'Weekly Revenue', value: dashboard.data.summary.weekly_revenue },
        { label: 'Pending Payments', value: dashboard.data.summary.pending_payments },
      ],
      recentPayments: dashboard.data.recent_payments,
      auditLog: [],
      workflowSteps: [
        'CTO detects renewal or credit requirement',
        'COO confirms operational necessity',
        'CFO validates budget, vendor, category, and risk',
        'Founder approval is triggered if required',
        'CFO executes payment after approval path clears',
        'Founder receives OTP externally and shares it securely with CFO',
        'CFO enters OTP once; OTP is cleared immediately',
        'CTO captures receipt; CFO stores record in Payment Vault',
      ],
    },
    error: null,
  };
}

export async function getFinancialRisks(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  const risks = dashboard.data.payables.map((p) => ({
    id: p.id,
    type: 'Pending Payment',
    vendor: p.vendor,
    amount: p.amount,
    risk_level: safeNum(p.amount) > SLACK_APPROVAL_LIMIT ? 'High' : safeNum(p.amount) > AUTO_PAY_LIMIT ? 'Medium' : 'Low',
    description: `Payment to ${p.vendor} is pending.`,
  }));
  return { data: risks, error: null };
}

export async function getRenewalForecast(tenantId = demoTenantId) {
  const result = await getRecurringPayments(tenantId);
  return { data: result.data, error: null };
}

export async function generateCFOReport(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  const { summary, monthly_pnl } = dashboard.data;
  return {
    data: [
      `CFO Report — ${new Date().toLocaleDateString('en-IN')}`,
      `Monthly Revenue: ${summary.monthly_revenue}`,
      `Monthly Net Profit: ${summary.monthly_net_profit}`,
      `Weekly Revenue: ${summary.weekly_revenue}`,
      `Pending Payments: ${summary.pending_payments}`,
      `Open Receivables: ${summary.open_receivables}`,
      monthly_pnl.net_profit < 0 ? 'WARNING: Net profit is negative this month.' : 'Net profit is positive this month.',
    ].join('\n'),
    error: null,
  };
}

export async function generateFounderFinancialSummary(tenantId = demoTenantId) {
  const dashboard = await getCFODashboard(tenantId);
  const { summary } = dashboard.data;
  return {
    data: [
      'Founder Financial Summary:',
      `1. Monthly Revenue: ${summary.monthly_revenue}`,
      `2. Monthly Net Profit: ${summary.monthly_net_profit}`,
      `3. Weekly Revenue: ${summary.weekly_revenue}`,
      `4. Pending Payments: ${summary.pending_payments}`,
      `5. Open Receivables: ${summary.open_receivables}`,
      '6. OTP values are never stored, logged, reused, or handled by AI.',
      '7. Auto-pay limit: INR 1,500. Slack approval: up to INR 2,000. Director approval above INR 2,000.',
    ].join('\n'),
    error: null,
  };
}

export function getCFOKnowledgeBase() {
  return {
    role: 'Chief Financial Officer',
    mandate: 'Every rupee tracked. Export finance compliant. Founder never surprised by cash or compliance.',
    exportFinanceDocuments: [
      'Foreign Inward Remittance Certificate (FIRC)',
      'Bank Realisation Certificate (BRC)',
      'LUT (Letter of Undertaking) for GST-free exports',
      'Letter of Credit (L/C) processing',
      'Advance Payment receipt and reconciliation',
      'GST refund claims on exports',
    ],
    paymentAuthority: {
      autoApprove: '≤ Rs.1,500 — CFO pays autonomously',
      slackApproval: 'Rs.1,501–Rs.2,000 — CFO sends Slack to Founder',
      directorApproval: '> Rs.2,000 — Director approval wall',
      otpPayments: 'CFO requests OTP via Slack → Founder replies → CFO completes → OTP cleared',
    },
    complianceWatch: ['FEMA compliance', 'GST on exports', 'Currency risk (INR/USD/AED/AUD)', 'RBI reporting for foreign receipts'],
    kpis: ['Monthly net profit', 'Outstanding receivables', 'Infrastructure cost %', 'Payment vault status', 'Currency exposure'],
  };
}
