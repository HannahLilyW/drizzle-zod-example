import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';

import { OpenAPIHono } from '@hono/zod-openapi';
import { createPatchRoute } from './utils';
import { createZodSchemas } from './zodUtils';
import { usersTable } from './db/schema';
import { eq } from 'drizzle-orm';

const app = new OpenAPIHono();

const db = drizzle(process.env.DATABASE_URL!);

app.openapi(createPatchRoute({
    path: '/users/{pk}',
    schemas: createZodSchemas(usersTable, ['name', 'email', 'nickname', 'bio', 'creditBalance', 'birthDate', 'isActive'])
}), async (c) => {
    const request = c.req.valid('json')
    const { pk } = c.req.valid('param')
    const [user] = await db.update(usersTable).set(request)
        .where(eq(usersTable.id, Number(pk))).returning()
    return c.json(user, 200)
})

