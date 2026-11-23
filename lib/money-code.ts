import { createHash } from "node:crypto";

/** How the emailed Money code is kept: hashed with its owner, never as the code itself. */
export const hashCode = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");
