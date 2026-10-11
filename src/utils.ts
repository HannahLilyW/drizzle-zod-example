import { createRoute, z } from '@hono/zod-openapi'

export function createPatchRoute<T extends z.ZodObject, U extends z.ZodObject>(config: {
    path: string,
    schemas: {
        patch: T,
        response: U
    }
}) {
    return createRoute({
        method: 'patch',
        path: config.path,
        request: {
            params: z.object({
                pk: z.string().openapi({
                    param: {
                        name: 'pk',
                        in: 'path'
                    }
                }),
            }),
            body: {
                content: {
                    'application/json': {
                        schema: config.schemas.patch,
                    },
                },
                required: true, 
            },
        },
        responses: {
            200: {
                content: {
                    'application/json': {
                        schema: config.schemas.response,
                    },
                },
            },
        },
    })
}