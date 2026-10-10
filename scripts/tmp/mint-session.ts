import { createSessionToken } from "../../src/lib/fitness/auth";
const uid = process.argv[2];
if (!uid) { console.error("usage: bun scripts/tmp/mint-session.ts <userId>"); process.exit(1); }
console.log(await createSessionToken(uid));
