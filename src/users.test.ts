import { describe, expect, test } from "bun:test";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, numeric, pgTable } from "drizzle-orm/pg-core";
import { createSchemaFactory } from "drizzle-zod";
import { usersTable } from "./db/schema";
import { createPatchRoute } from "./utils";
import { createZodSchemas } from "./zodUtils";

const PATCHABLE = [
    'name', 'email', 'nickname', 'bio', 'creditBalance', 'birthDate', 'isActive',
] as const;

const schemas = createZodSchemas(usersTable, PATCHABLE);

const parse = (body: unknown) => schemas.patch.safeParse(body);

describe("patch schema: required-vs-optional", () => {
    test("accepts a single field (PATCH semantics, not full replacement)", () => {
        const r = parse({ name: "Hannah" });
        expect(r.success).toBe(true);
        expect(r.success && r.data).toEqual({ name: "Hannah" });
    });

    test("rejects an empty body", () => {
        // Every update column is optional, so without the refinement this would
        // reach db.update().set({}), which drizzle throws on ("No values to set").
        const r = parse({});
        expect(r.success).toBe(false);
        expect(r.success === false && r.error.issues[0]?.message).toBe(
            "At least one field must be provided",
        );
    });

    test("rejects a body whose only keys are not patchable", () => {
        // z.object strips unknown keys, so this reduces to {} and trips the refinement.
        expect(parse({ id: 99 }).success).toBe(false);
        expect(parse({ loginCount: 5 }).success).toBe(false);
    });

    test("strips non-patchable keys rather than passing them through to .set()", () => {
        const r = parse({ name: "Hannah", id: 99, loginCount: 5 });
        expect(r.success).toBe(true);
        expect(r.success && r.data).toEqual({ name: "Hannah" });
    });
});

describe("patch schema: string columns are not coerced", () => {
    // z.coerce.string() is String(x), which never fails. With string coercion on,
    // each of these silently became a string and hit a NOT NULL / varchar column.
    test.each([
        ["null on a NOT NULL column", { name: null }],
        ["a number", { name: 123 }],
        ["an array", { name: ["a", "b"] }],
        ["an object", { name: { nested: true } }],
    ])("rejects %s", (_label, body) => {
        expect(parse(body).success).toBe(false);
    });

    test("accepts an actual string", () => {
        expect(parse({ name: "Hannah" }).success).toBe(true);
    });

    test("allows null on a nullable column", () => {
        const r = parse({ nickname: null });
        expect(r.success).toBe(true);
        expect(r.success && r.data).toEqual({ nickname: null });
    });
});

describe("patch schema: number coercion", () => {
    test("coerces a numeric string", () => {
        const r = parse({ creditBalance: "12.50" });
        expect(r.success).toBe(true);
        expect(r.success && r.data.creditBalance).toBe(12.5);
    });

    test("accepts a real number", () => {
        const r = parse({ creditBalance: 12.5 });
        expect(r.success).toBe(true);
        expect(r.success && r.data.creditBalance).toBe(12.5);
    });

    test("rejects a non-numeric string", () => {
        expect(parse({ creditBalance: "abc" }).success).toBe(false);
    });

    test("allows null (column is nullable)", () => {
        const r = parse({ creditBalance: null });
        expect(r.success).toBe(true);
        expect(r.success && r.data.creditBalance).toBeNull();
    });
});

describe("patch schema: date coercion", () => {
    test("coerces an ISO date string to a Date", () => {
        const r = parse({ birthDate: "1990-04-12" });
        expect(r.success).toBe(true);
        expect(r.success && r.data.birthDate).toBeInstanceOf(Date);
        expect(r.success && r.data.birthDate?.toISOString()).toBe("1990-04-12T00:00:00.000Z");
    });

    test("rejects an unparseable date", () => {
        expect(parse({ birthDate: "garbage" }).success).toBe(false);
    });

    test("allows null (column is nullable)", () => {
        expect(parse({ birthDate: null }).success).toBe(true);
    });
});

describe("patch schema: booleans are not coerced", () => {
    test("accepts a real boolean", () => {
        const r = parse({ isActive: false });
        expect(r.success).toBe(true);
        expect(r.success && r.data.isActive).toBe(false);
    });

    test("rejects a truthy string", () => {
        expect(parse({ isActive: "yes" }).success).toBe(false);
    });
});

describe("omitted fields retain their previous value", () => {
    // No database needed: .toSQL() shows exactly which columns the UPDATE touches.
    // A column absent from the SET clause is left alone by Postgres.
    const db = drizzle("postgres://localhost/unused-by-toSQL");

    const setClauseOf = (body: unknown) => {
        const parsed = schemas.patch.safeParse(body);
        if (!parsed.success) throw new Error("body did not validate");
        return db.update(usersTable).set(parsed.data).where(eq(usersTable.id, 1)).toSQL().sql;
    };

    test("a one-field patch only assigns that one column", () => {
        const sql = setClauseOf({ name: "Hannah" });
        expect(sql).toBe('update "users" set "name" = $1 where "users"."id" = $2');
    });

    test("untouched columns never appear in the SET clause", () => {
        const sql = setClauseOf({ nickname: "hbw" });
        for (const col of ["name", "email", "bio", "creditBalance", "birthDate", "isActive"]) {
            expect(sql).not.toContain(`"${col}"`);
        }
        expect(sql).toContain('"nickname"');
    });

    test("a multi-field patch assigns exactly the provided columns", () => {
        const sql = setClauseOf({ name: "Hannah", isActive: false });
        expect(sql).toBe(
            'update "users" set "name" = $1, "isActive" = $2 where "users"."id" = $3',
        );
    });

    test("an explicit undefined is treated as omitted, not as null", () => {
        // drizzle's mapUpdateSet filters undefined before building the SET clause.
        const sql = setClauseOf({ name: "Hannah", nickname: undefined });
        expect(sql).toBe('update "users" set "name" = $1 where "users"."id" = $2');
        expect(sql).not.toContain('"nickname"');
    });

    test("an explicit null DOES overwrite, unlike undefined", () => {
        // This is the meaningful distinction: null clears the column, undefined keeps it.
        const sql = setClauseOf({ nickname: null });
        expect(sql).toBe('update "users" set "nickname" = $1 where "users"."id" = $2');
    });

    test("rejects a body whose only key is undefined, rather than throwing in drizzle", () => {
        // Object.keys() would count this as non-empty, but drizzle filters undefined
        // and then throws "No values to set" -- so the refinement counts defined values.
        const parsed = schemas.patch.safeParse({ nickname: undefined });
        expect(parsed.success).toBe(false);

        // Prove the throw we are guarding against is real.
        expect(() =>
            db.update(usersTable).set({ nickname: undefined }).where(eq(usersTable.id, 1)).toSQL(),
        ).toThrow("No values to set");
    });
});

describe("drizzle-zod numeric coercion (regression guard for patches/drizzle-zod@0.8.3.patch)", () => {
    // Upstream 0.8.3 inverted the .int() ternary in numberColumnToSchema, so under
    // coercion a numeric column rejected fractions and an integer column accepted them.
    // https://github.com/drizzle-team/drizzle-orm/issues/4572
    const coerced = createSchemaFactory({ coerce: { date: true, number: true, bigint: true } });
    const t = pgTable("coercion_probe", {
        id: integer().primaryKey(),
        price: numeric({ precision: 10, scale: 2, mode: "number" }),
        count: integer(),
    });
    const schema = coerced.createUpdateSchema(t);

    test("a non-integer numeric column accepts fractions", () => {
        expect(schema.safeParse({ price: 12.5 }).success).toBe(true);
        expect(schema.safeParse({ price: "12.50" })).toMatchObject({
            success: true,
            data: { price: 12.5 },
        });
    });

    test("an integer column still rejects fractions", () => {
        expect(schema.safeParse({ count: 12.5 }).success).toBe(false);
        expect(schema.safeParse({ count: "12.5" }).success).toBe(false);
    });

    test("an integer column accepts integers and integral strings", () => {
        expect(schema.safeParse({ count: 12 })).toMatchObject({
            success: true,
            data: { count: 12 },
        });
        expect(schema.safeParse({ count: "12" })).toMatchObject({
            success: true,
            data: { count: 12 },
        });
    });
});

describe("PATCH /users/{pk} route", () => {
    /** Builds the app and reports whether the handler was reached. */
    function buildApp() {
        const app = new OpenAPIHono();
        const calls: unknown[] = [];

        app.openapi(
            createPatchRoute({ path: "/users/{pk}", schemas }),
            (c) => {
                calls.push(c.req.valid("json"));
                return c.json(
                    {
                        id: 1, name: "Hannah", age: 30, email: "h@example.com",
                        nickname: null, bio: null, creditBalance: null, loginCount: 0,
                        birthDate: null, lastSeenAt: null, isActive: true,
                        createdAt: new Date(),
                    },
                    200,
                );
            },
        );
        app.doc("/doc", { openapi: "3.0.0", info: { title: "test", version: "1" } });

        return {
            app,
            calls,
            patch: (body: unknown) =>
                app.request("/users/1", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                }),
        };
    }

    test("a valid partial body reaches the handler", async () => {
        const { patch, calls } = buildApp();
        const res = await patch({ name: "Hannah" });
        expect(res.status).toBe(200);
        expect(calls).toEqual([{ name: "Hannah" }]);
    });

    test("coerced values reach the handler already converted", async () => {
        const { patch, calls } = buildApp();
        const res = await patch({ creditBalance: "12.50", birthDate: "1990-04-12" });
        expect(res.status).toBe(200);
        expect(calls[0]).toMatchObject({ creditBalance: 12.5 });
        expect((calls[0] as { birthDate: Date }).birthDate).toBeInstanceOf(Date);
    });

    test.each([
        ["an empty body", {}],
        ["null on a NOT NULL column", { name: null }],
        ["an object on a string column", { name: { nested: true } }],
        ["a non-numeric string", { creditBalance: "abc" }],
        ["an unparseable date", { birthDate: "garbage" }],
        ["a truthy string for a boolean", { isActive: "yes" }],
        ["only non-patchable keys", { id: 99 }],
    ])("rejects %s with 400 without reaching the handler", async (_label, body) => {
        const { patch, calls } = buildApp();
        const res = await patch(body);
        expect(res.status).toBe(400);
        expect(calls).toEqual([]);
    });

    test("documents only the patchable columns in the OpenAPI spec", async () => {
        const { app } = buildApp();
        const doc = await (await app.request("/doc")).json() as {
            paths: Record<string, {
                patch: {
                    requestBody: {
                        content: Record<string, { schema: { properties: Record<string, unknown> } }>;
                    };
                };
            }>;
        };
        const properties = doc.paths["/users/{pk}"]!.patch.requestBody
            .content["application/json"]!.schema.properties;

        expect(Object.keys(properties).sort()).toEqual([...PATCHABLE].sort());
    });
});

describe("type-level constraints", () => {
    type Expect<T extends true> = T;
    type IsEqual<A, B> =
        (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false;

    type PatchBody = z.infer<typeof schemas.patch>;

    type Assertions = [
        // The handler's body type is the picked columns, not Record<string, unknown>.
        Expect<IsEqual<keyof PatchBody, (typeof PATCHABLE)[number]>>,
        // Every field is optional, because createUpdateSchema is built for PATCH.
        Expect<IsEqual<PatchBody["name"], string | undefined>>,
        // A nullable column keeps its null in the type.
        Expect<IsEqual<PatchBody["nickname"], string | null | undefined>>,
    ];

    // Rejected at compile time; never executed.
    function callSiteGuards() {
        // @ts-expect-error 'nmae' is a typo, not a column
        createZodSchemas(usersTable, ["nmae"]);
        // @ts-expect-error 'id' is generatedAlwaysAsIdentity, so absent from the update schema
        createZodSchemas(usersTable, ["id"]);
        // @ts-expect-error 'createdAt' is fine, but 'nope' is not
        createZodSchemas(usersTable, ["createdAt", "nope"]);
    }

    test("body type matches the patchable columns (enforced by `bun check`)", () => {
        // Only assignable if every Expect<...> above resolved to true.
        const assertions: Assertions = [true, true, true];
        expect(assertions).toEqual([true, true, true]);
        expect(typeof callSiteGuards).toBe("function");
    });
});
