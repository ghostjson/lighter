// Usage: npm run hash -- "my password"
import { hashPassword } from '../lib/passwords.js';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: npm run hash -- "your password"');
  process.exit(1);
}
console.log(hashPassword(pw));
