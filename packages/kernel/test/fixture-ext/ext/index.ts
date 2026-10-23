import { auth, badRequest, defineExtension, parse, requirePerm, z } from '../../../src/index.ts';

export default defineExtension({
  routes(app, k) {
    app.post('/x/notes/:id/priority', async (req) => {
      const a = auth(req);
      requirePerm(a, 'notes.x_priority.write');
      const { priority } = parse(z.object({ priority: z.number().int().min(0).max(9) }), req.body);
      const { id } = req.params as { id: string };
      return k.db.tx(a.tenantId, async (c) => (await c.query('update notes set priority = $2 where id = $1 returning *', [id, priority])).rows[0]);
    });
  },
  guards: {
    'POST /notes': async (req) => {
      const body = (req.body ?? {}) as { body?: string };
      if (typeof body.body === 'string' && body.body.length > 20) throw badRequest('โน้ตยาวเกิน 20 ตัวอักษร (กฎของบริษัท)');
    },
  },
  handlers: {
    'master.item_upserted': async (data, ctx) => {
      await ctx.client.query(`insert into note_tags(note_id, tag) select id, 'item' from notes where body = $1`, [`item ${data.code}`]);
    },
    'sales.invoiced': async (data, ctx) => {
      await ctx.client.query('insert into notes(body, priority) values ($1, 5)', [`invoice ${data.invoiceNo}`]);
    },
  },
});
