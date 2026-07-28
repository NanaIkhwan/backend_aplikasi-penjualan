require('dotenv').config();
const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Inisialisasi database dan tabel menggunakan koneksi terpisah (tanpa memilih DB dulu)
const initConnection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

initConnection.connect((err) => {
  if (err) {
    console.error('❌ Gagal terhubung ke MySQL (Pastikan XAMPP/MySQL menyala!):', err);
    return;
  }
  console.log('✅ Terhubung ke server MySQL.');

  const dbName = process.env.DB_NAME;

  initConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``, (err) => {
    if (err) throw err;
    console.log(`✅ Database '${dbName}' berhasil disiapkan.`);

    initConnection.query(`USE \`${dbName}\``, (err) => {
      if (err) throw err;

      const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'user',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      const createProductsTable = `
        CREATE TABLE IF NOT EXISTS products (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          price DECIMAL(10, 2) NOT NULL,
          stock INT DEFAULT 0,
          image_url VARCHAR(255),
          category VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      const createOrdersTable = `
        CREATE TABLE IF NOT EXISTS orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          product_id INT,
          quantity INT NOT NULL,
          total_price DECIMAL(10, 2) NOT NULL,
          longitude DECIMAL(11, 8),
          status VARCHAR(50) DEFAULT 'Menunggu Pembayaran',
          order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (product_id) REFERENCES products(id)
        )
      `;

      const createCartsTable = `
        CREATE TABLE IF NOT EXISTS carts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          product_id INT,
          quantity INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (product_id) REFERENCES products(id)
        )
      `;

      const createChatsTable = `
        CREATE TABLE IF NOT EXISTS chats (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          sender ENUM('user', 'admin') NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `;

      initConnection.query(createUsersTable, (err) => {
        if (err) throw err;
        console.log('✅ Tabel users siap.');
      });

      initConnection.query(createUsersTable, (err) => { if (err) console.error(err); });
      initConnection.query(createProductsTable, (err) => {
        if (err) console.error(err);
        initConnection.query('ALTER TABLE products ADD COLUMN category VARCHAR(100)', () => {});
      });

      initConnection.query(createOrdersTable, (err) => {
        if (err) console.error(err);
        else {
          // Add status column to existing table just in case
          initConnection.query(`ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'Menunggu Pembayaran'`, (err) => {
            // Ignore error if column already exists
          });
        }
      });
      initConnection.query(createCartsTable, (err) => { if (err) console.error(err); });
      initConnection.query(createChatsTable, (err) => {
        if (err) console.error(err);
        console.log('✅ Tabel chats siap.');
        initConnection.end();
      });
    });
  });
});

module.exports = pool.promise();
