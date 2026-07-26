require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function seedAdmin() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('✅ Terhubung ke database...');

  // Data akun admin
  const adminData = {
    name: 'Administrator',
    email: 'admin@hardware.com',
    password: 'admin123',
    role: 'admin',
  };

  try {
    // Cek apakah admin sudah ada
    const [existing] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [adminData.email]
    );

    if (existing.length > 0) {
      console.log('⚠️  Akun admin sudah ada! Tidak perlu dibuat lagi.');
      console.log(`📧 Email   : ${adminData.email}`);
      console.log(`🔑 Password: ${adminData.password}`);
    } else {
      const hashedPassword = await bcrypt.hash(adminData.password, 10);
      await connection.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [adminData.name, adminData.email, hashedPassword, adminData.role]
      );
      console.log('');
      console.log('✅ Akun admin berhasil dibuat!');
      console.log('================================');
      console.log(`👤 Nama    : ${adminData.name}`);
      console.log(`📧 Email   : ${adminData.email}`);
      console.log(`🔑 Password: ${adminData.password}`);
      console.log(`🛡️  Role    : ${adminData.role}`);
      console.log('================================');
      console.log('');
      console.log('Buka Admin Panel di: http://localhost:3000/admin/admin.html');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await connection.end();
    process.exit(0);
  }
}

seedAdmin();
