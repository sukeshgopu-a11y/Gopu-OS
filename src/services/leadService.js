import { createTableService } from './serviceHelpers.js';
import { createAuditLog } from './auditService.js';
import { processNewLead } from './autonomousLeadPipeline.js';

export const leadService = createTableService('lead_intake');
export const whatsappIntakeCommandService = createTableService('whatsapp_intake_commands');
export const leadWorkflowEventService = createTableService('lead_workflow_events');

export async function createLeadDraft(payload) {
  const result = await leadService.create({ ...payload, status: payload.status || 'Draft' });

  if (result.ok) {
    await createAuditLog({
      tenant_id: payload.tenant_id,
      action_type: 'Lead created',
      module: 'Lead Intake',
      related_table: 'lead_intake',
      related_record_id: result.data?.id,
      actor: payload.source || 'Director Command',
      description: `Lead created for ${payload.company_name || payload.buyer_name || 'new buyer enquiry'}.`,
      new_value: result.data || payload,
      risk_level: 'Low'
    });

    // Autonomous pipeline: all 5 agents process this lead automatically.
    // Runs in the background — does not block the lead draft response.
    const leadWithId = { ...payload, id: result.data?.id || payload.id };
    processNewLead(leadWithId, payload.tenant_id).catch((err) => {
      console.error('[autonomous-pipeline] Lead processing failed safely', {
        lead_id: leadWithId.id,
        buyer: payload.buyer_name,
        message: err?.message || 'Unknown pipeline error'
      });
    });
  }

  return result;
}
