import { auth, loadManifest, one, parse, requirePerm, s, z, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const RecordInput = z.object({ code: s.code, name: s.name });

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.get('/records', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.record.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from records order by code')).rows);
    });

    app.get('/records/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.record.read');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from records where id = $1', [id], 'Record'));
    });

    app.post('/records', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.record.write');
      const b = parse(RecordInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into records (code, name, created_by) values ($1, $2, $3) returning *', [b.code, b.name, a.userId])).rows[0]);
    });
  },
};
