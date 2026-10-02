import {
  auth, hashPassword, loadManifest, one, parse, requirePerm, s, signToken, unauthorized, verifyPassword, z,
  type Client, type ServiceDefinition,
} from '@erp/kernel';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8);

const TenantInput = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/),
  name: s.name,
  admin: z.object({ email, name: s.name, password }),
});
const LoginInput = z.object({ tenant: z.string().trim().toLowerCase(), email, password: z.string() });
const UserInput = z.object({ email, name: s.name, password, roleIds: z.array(s.uuid).default([]) });
const RoleInput = z.object({ name: s.name, permissions: z.array(z.string().regex(/^(\*|[a-z-]+\.(\*|[a-z_.]+))$/)) });

async function permissionsOf(c: Client, userId: string): Promise<string[]> {
  const r = await c.query<{ p: string }>(
    `select distinct unnest(r.permissions) as p from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1`,
    [userId],
  );
  return r.rows.map((x) => x.p).sort();
}

const publicUser = `id, email, name, active, created_at`;

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    const secret = k.env.JWT_SECRET!;
    const ttl = Number(k.env.JWT_TTL_SECONDS ?? 60 * 60 * 12);

    /** Create a company + its first admin. Called by GO Along's provisioning (internal token), not by end users. */
    app.post('/tenants', { config: { internal: true } }, async (req, reply) => {
      const body = parse(TenantInput, req.body);
      const tenant = await k.db.rawTx(async (c) => (await c.query('insert into tenants (code, name) values ($1, $2) returning *', [body.code, body.name])).rows[0]);
      const user = await k.db.tx(tenant.id, async (c) => {
        const role = (await c.query(`insert into roles (name, permissions) values ('Administrator', '{*}') returning id`)).rows[0];
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [body.admin.email, body.admin.name, hashPassword(body.admin.password)])).rows[0];
        await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, role.id]);
        return u;
      });
      reply.code(201);
      return { tenant, admin: user };
    });

    app.post('/auth/login', { config: { public: true } }, async (req) => {
      const body = parse(LoginInput, req.body);
      const tenant = (await k.db.pool.query('select id, code, name from tenants where code = $1', [body.tenant])).rows[0];
      if (!tenant) throw unauthorized('Invalid credentials');
      return k.db.tx(tenant.id, async (c) => {
        const u = (await c.query('select * from users where email = $1 and active', [body.email])).rows[0];
        if (!u || !verifyPassword(body.password, u.password_hash)) throw unauthorized('Invalid credentials');
        const perms = await permissionsOf(c, u.id);
        const token = signToken(secret, { tenantId: tenant.id, userId: u.id, perms, userName: u.name }, ttl);
        return { token, expiresIn: ttl, tenant, user: { id: u.id, email: u.email, name: u.name }, permissions: perms };
      });
    });

    app.get('/me', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [a.userId], 'User');
        return { ...u, tenantId: a.tenantId, permissions: await permissionsOf(c, a.userId) };
      });
    });

    app.get('/users', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      return k.db.tx(a.tenantId, async (c) =>
        (await c.query(`select ${publicUser.split(', ').map((f) => 'u.' + f).join(', ')},
          coalesce(array_agg(r.name order by r.name) filter (where r.id is not null), '{}') as roles
          from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id
          group by u.id order by u.email`)).rows);
    });

    app.post('/users', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const body = parse(UserInput, req.body);
      const user = await k.db.tx(a.tenantId, async (c) => {
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [body.email, body.name, hashPassword(body.password)])).rows[0];
        for (const roleId of body.roleIds) await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, roleId]);
        return u;
      });
      reply.code(201);
      return user;
    });

    app.put('/users/:id/roles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      const { roleIds } = parse(z.object({ roleIds: z.array(s.uuid) }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from users where id = $1', [id], 'User');
        await c.query('delete from user_roles where user_id = $1', [id]);
        for (const roleId of roleIds) await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [id, roleId]);
        return { userId: id, permissions: await permissionsOf(c, id) };
      });
    });

    app.post('/users/:id/deactivate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, (c) => one(c, `update users set active = false where id = $1 returning ${publicUser}`, [id], 'User'));
    });

    app.get('/roles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from roles order by name')).rows);
    });

    app.post('/roles', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.role.write');
      const body = parse(RoleInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into roles (name, permissions) values ($1, $2) returning *', [body.name, body.permissions])).rows[0]);
    });
  },
};
