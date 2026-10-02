/**
 * Demo rules for the automation module. Seeded BEFORE the demo's business activity, so the rules
 * really fire on the demo's events and the bell has believable notifications when you log in.
 */
type Call = (method: string, path: string, body?: unknown) => Promise<any>;

export async function seedAutomation(call: Call): Promise<void> {
  const templates: { id: string }[] = await call('GET', '/api/automation/templates');
  for (const t of templates) await call('POST', `/api/automation/templates/${t.id}/apply`, {});
  await call('POST', '/api/automation/rules/simple', {
    name: 'ขายลูกค้ารายใหญ่ แจ้งฝ่ายผลิต',
    eventType: 'sales.order_confirmed',
    conditionField: 'total', conditionOp: 'gte', conditionValue: 100000,
    actionType: 'notify',
    message: 'ออเดอร์ใหญ่ {{orderNo}} ของ {{customerName}} ยอด {{total}} บาท — เช็ควัตถุดิบและคิวผลิต',
  });
}
