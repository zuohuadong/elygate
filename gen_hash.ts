import { password } from 'bun';
import { writeFileSync } from 'fs';
const h = await password.hash('admin123', 'argon2id');
writeFileSync('/tmp/hash_out.txt', h);
process.stdout.write(h + '\n');
