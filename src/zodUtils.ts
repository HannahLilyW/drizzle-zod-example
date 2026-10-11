import { z } from "@hono/zod-openapi"
import type { PgTable } from "drizzle-orm/pg-core"
import { createSchemaFactory, createSelectSchema } from "drizzle-zod"

// Coerce dates and numbers (they arrive as strings from query params and JSON),
// but NOT strings: z.coerce.string() is String(x), which never fails, so it would
// quietly turn null into "null" and {} into "[object Object]".
const coerced = createSchemaFactory({
  coerce: { date: true, number: true, bigint: true }
});

type UpdateShapeOf<T extends PgTable> = ReturnType<typeof coerced.createUpdateSchema<T>>['shape'];

export function createZodSchemas<T extends PgTable, K extends keyof UpdateShapeOf<T> & string>(table: T, allowedPatchUpdateCols: readonly K[]) {
    const base = coerced.createUpdateSchema(table);
    const shape = Object.fromEntries(
        allowedPatchUpdateCols.map((c) => [c, base.shape[c]])
    ) as Pick<UpdateShapeOf<T>, K>;

    return {
        // All update columns are optional, so an empty body would otherwise reach
        // db.update().set({}), which drizzle rejects at runtime with "No values to set".
        // Count *defined* values, not keys: drizzle's mapUpdateSet filters undefined
        // before checking for emptiness, so { nickname: undefined } is empty to it too.
        patch: z.object(shape).refine((v) => Object.values(v).some((x) => x !== undefined), {
            message: 'At least one field must be provided'
        }),
        response: createSelectSchema(table)
    }
}
