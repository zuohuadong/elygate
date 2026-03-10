// Update admin password
import { sql } from '@elygate/db';

const password = "123qwe";
const passwordHash = await Bun.password.hash(password);

const result = await sql`
  UPDATE users
  SET password_hash = ${passwordHash}
  WHERE username = 'admin'
`;

console.log("Password updated successfully");
console.log("New hash:", passwordHash);
console.log("Rows updated:", result.count);

process.exit(0);
