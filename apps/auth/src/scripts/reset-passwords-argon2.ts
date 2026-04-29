import { Client } from 'pg';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function migrate() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const defaultPassword = '123456Aa';
    console.log(`Hashing default password: ${defaultPassword}...`);

    const hash = await argon2.hash(defaultPassword);
    console.log('Hash generated:', hash);

    console.log('Updating all local accounts...');
    const query = `
      UPDATE auth 
      SET password = $1 
      WHERE provider_type = 'local';
    `;

    const res = await client.query(query, [hash]);
    console.log(`Successfully updated ${res.rowCount} accounts.`);
    console.log('---');
    console.log(`Mọi tài khoản local giờ đây có mật khẩu là: ${defaultPassword}`);
    console.log('Bạn có thể dùng mật khẩu này để chạy Load Test.');

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
