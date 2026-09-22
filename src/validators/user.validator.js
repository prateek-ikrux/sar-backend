import { z } from "zod";
import { email, objectId, requiredString } from "./common.validator.js";
import { ROLES } from "../constants.js";

const roles = Object.values(ROLES);

const name = requiredString()
    .trim()
    .min(1, { error: "cannot be empty" })
    .max(120, { error: "must be at most 120 characters" });

const role = z.enum(roles, { error: `must be one of: ${roles.join(", ")}` });

const createUserSchema = z.strictObject({
    email,
    name,
    role: role.optional(),
});

const updateUserSchema = z
    .strictObject({
        name: name.optional(),
        role: role.optional(),
        active: z.boolean({ error: "must be true or false" }).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
        error: "send one of: name, role, active",
    });

const userIdParamSchema = z.object({ id: objectId });

const listUsersQuerySchema = z.strictObject({
    page: z.coerce
        .number({ error: "must be a number" })
        .int({ error: "must be a whole number" })
        .min(1, { error: "must be at least 1" })
        .default(1),
    limit: z.coerce
        .number({ error: "must be a number" })
        .int({ error: "must be a whole number" })
        .min(1, { error: "must be at least 1" })
        .max(100, { error: "must be at most 100" })
        .default(20),
});

export {
    createUserSchema,
    updateUserSchema,
    userIdParamSchema,
    listUsersQuerySchema,
};
