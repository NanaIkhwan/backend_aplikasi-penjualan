require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./database');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});
app.use(cors());
app.use(express.json());
// Redirect root ke halaman admin login
app.get('/', (req, res) => {
  res.redirect('/admin/admin.html');
});

// Serve halaman admin dari folder public/
app.use('/admin', express.static(path.join(__dirname, 'public')));
// Serve folder uploads agar gambar bisa diakses dari Flutter/browser
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Konfigurasi Multer untuk upload gambar
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `product_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diperbolehkan (jpg, png, webp)'));
    }
  }
});

const JWT_SECRET = process.env.JWT_SECRET;

// ==========================================
// MIDDLEWARE: Verifikasi Token JWT
// ==========================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Akses ditolak, token tidak ada' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token tidak valid' });
    req.user = user;
    next();
  });
};

// ==========================================
// UPLOAD GAMBAR
// ==========================================
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diupload' });
  // Buat URL yang bisa diakses dari luar
  const host = req.get('host'); // misal: 192.168.1.8:3000
  const protocol = req.headers['x-forwarded-proto'] || req.protocol; // Dukung reverse proxy Railway (HTTPS)
  const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
  res.json({ message: 'Upload berhasil', imageUrl, filename: req.file.filename });
});

// ==========================================
// AUTH ROUTES
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan password wajib diisi' });
    }
    const cleanEmail = email.trim();
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email sudah terdaftar' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = role === 'admin' ? 'admin' : 'user';
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, cleanEmail, hashedPassword, userRole]
    );
    res.status(201).json({ message: 'Registrasi berhasil', userId: result.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email ? email.trim() : '';
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({
      message: 'Login berhasil',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Update Profil (Admin)
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email tidak boleh kosong' });
    }
    const cleanEmail = email.trim();
    
    // Pastikan email tidak dipakai user lain (kecuali diri sendiri)
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [cleanEmail, req.user.userId]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email sudah terdaftar oleh akun lain' });
    }

    if (newPassword && newPassword.trim() !== '') {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET email = ?, password = ? WHERE id = ?', [cleanEmail, hashedPassword, req.user.userId]);
    } else {
      await db.query('UPDATE users SET email = ? WHERE id = ?', [cleanEmail, req.user.userId]);
    }
    
    res.json({ message: 'Profil berhasil diperbarui' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// ==========================================
// PRODUCTS ROUTES
// ==========================================

// Get semua produk
app.get('/api/products', async (req, res) => {
  try {
    const [products] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    // Pastikan protocol selalu HTTPS saat production untuk menghindari Cleartext Traffic Error di Flutter
    const formattedProducts = products.map(p => ({
      ...p,
      image_url: (p.image_url && p.image_url.startsWith('http://') && req.get('host').includes('railway.app')) 
        ? p.image_url.replace('http://', 'https://') 
        : p.image_url
    }));
    res.json(formattedProducts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Get detail produk
app.get('/api/products/:id', async (req, res) => {
  try {
    const [products] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (products.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    let product = products[0];
    if (product.image_url && product.image_url.startsWith('http://') && req.get('host').includes('railway.app')) {
      product.image_url = product.image_url.replace('http://', 'https://');
    }
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Tambah produk baru (butuh login)
app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const { name, description, price, stock, image_url, category } = req.body;
    if (!name || !price) {
      return res.status(400).json({ error: 'Nama produk dan harga wajib diisi' });
    }
    const [result] = await db.query(
      'INSERT INTO products (name, description, price, stock, image_url, category) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || '', price, stock || 0, image_url || '', category || '']
    );
    res.status(201).json({ message: 'Produk berhasil ditambahkan', productId: result.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});
// Hapus produk (butuh login)
app.delete('/api/products/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ message: 'Produk berhasil dihapus' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Edit produk (butuh login)
app.put('/api/products/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang bisa mengubah produk' });
  try {
    const { id } = req.params;
    const { name, description, price, stock, image_url, category } = req.body;
    
    // Pastikan HTTPS
    let finalImageUrl = image_url;
    if (finalImageUrl && finalImageUrl.startsWith('http://') && req.get('host').includes('railway.app')) {
      finalImageUrl = finalImageUrl.replace('http://', 'https://');
    }

    const [result] = await db.query(
      'UPDATE products SET name = ?, description = ?, price = ?, stock = ?, image_url = ?, category = ? WHERE id = ?',
      [name, description, price, stock, finalImageUrl, category, id]
    );
    res.json({ message: 'Produk berhasil diupdate' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// ==========================================
// CART ROUTES
// ==========================================

// Get cart items
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const query = `
      SELECT c.id as cart_id, c.quantity, p.id as product_id, p.name, p.price, p.image_url, p.stock
      FROM carts c
      JOIN products p ON c.product_id = p.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `;
    const [cart] = await db.query(query, [userId]);
    
    const formattedCart = cart.map(item => ({
      ...item,
      image_url: (item.image_url && item.image_url.startsWith('http://') && req.get('host').includes('railway.app')) 
        ? item.image_url.replace('http://', 'https://') 
        : item.image_url
    }));
    
    res.json(formattedCart);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Add to cart
app.post('/api/cart', authenticateToken, async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    const userId = req.user.userId;
    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'Product ID dan quantity wajib diisi' });
    }

    // Cek apakah produk sudah ada di keranjang
    const [existing] = await db.query('SELECT id, quantity FROM carts WHERE user_id = ? AND product_id = ?', [userId, product_id]);
    if (existing.length > 0) {
      // Update quantity
      await db.query('UPDATE carts SET quantity = quantity + ? WHERE id = ?', [quantity, existing[0].id]);
      return res.json({ message: 'Kuantitas produk di keranjang diperbarui' });
    } else {
      // Insert baru
      await db.query('INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)', [userId, product_id, quantity]);
      return res.status(201).json({ message: 'Produk berhasil ditambahkan ke keranjang' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Update cart quantity
app.put('/api/cart/:id', authenticateToken, async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'Kuantitas tidak valid' });
    await db.query('UPDATE carts SET quantity = ? WHERE id = ? AND user_id = ?', [quantity, req.params.id, req.user.userId]);
    res.json({ message: 'Kuantitas berhasil diupdate' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Remove from cart
app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM carts WHERE id = ? AND user_id = ?', [req.params.id, req.user.userId]);
    res.json({ message: 'Produk berhasil dihapus dari keranjang' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// ==========================================

// Checkout (Buat Order dengan Koordinat GPS)
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { product_id, quantity, latitude, longitude } = req.body;
    const user_id = req.user.userId;
    if (!product_id || !quantity || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Data pesanan tidak lengkap (termasuk koordinat GPS)' });
    }
    const [products] = await db.query('SELECT price, stock FROM products WHERE id = ?', [product_id]);
    if (products.length === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    const product = products[0];
    if (product.stock < quantity) {
      return res.status(400).json({ error: 'Stok tidak mencukupi' });
    }
    const total_price = product.price * quantity;
    const [result] = await db.query(
      'INSERT INTO orders (user_id, product_id, quantity, total_price, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, product_id, quantity, total_price, latitude, longitude]
    );
    await db.query('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, product_id]);
    res.status(201).json({ message: 'Checkout berhasil!', orderId: result.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Get daftar pesanan (user = pesanannya sendiri, admin = semua)
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    let query = `
      SELECT o.id, o.product_id, o.quantity, o.total_price, o.latitude, o.longitude, o.order_date,
             p.name AS product_name, p.image_url,
             u.name AS user_name
      FROM orders o
      JOIN products p ON o.product_id = p.id
      JOIN users u ON o.user_id = u.id
    `;
    let params = [];
    if (role !== 'admin') {
      query += ' WHERE o.user_id = ?';
      params.push(userId);
    }
    query += ' ORDER BY o.order_date DESC';
    const [orders] = await db.query(query, params);
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Get profil user yang sedang login
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
      [req.user.userId]
    );
    if (users.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(users[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Get semua user (Hanya Admin)
app.get('/api/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak, hanya admin' });
  try {
    const [users] = await db.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// ==========================================
// CHAT ROUTES & SOCKET.IO
// ==========================================

// Get daftar pengguna yang pernah chat (Untuk Admin)
app.get('/api/chats/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak' });
  try {
    const query = `
      SELECT u.id, u.name, u.email, MAX(c.created_at) as last_chat
      FROM users u
      JOIN chats c ON u.id = c.user_id
      GROUP BY u.id, u.name, u.email
      ORDER BY last_chat DESC
    `;
    const [users] = await db.query(query);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Get riwayat chat dengan user tertentu
app.get('/api/chats/:userId', authenticateToken, async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    // User hanya bisa akses chatnya sendiri, Admin bisa akses semua
    if (req.user.role !== 'admin' && req.user.userId != targetUserId) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    const [chats] = await db.query('SELECT * FROM chats WHERE user_id = ? ORDER BY created_at ASC', [targetUserId]);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
});

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('🔌 User connected to socket:', socket.id);

  // Bergabung ke room spesifik (user_{userId})
  socket.on('join_room', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User joined room: user_${userId}`);
  });

  socket.on('send_message', async (data) => {
    try {
      const { user_id, sender, message } = data;
      // Simpan ke database
      const [result] = await db.query(
        'INSERT INTO chats (user_id, sender, message) VALUES (?, ?, ?)',
        [user_id, sender, message]
      );
      
      const newMessage = {
        id: result.insertId,
        user_id,
        sender,
        message,
        created_at: new Date()
      };

      // Broadcast pesan ke user spesifik dan ke admin yang sedang memantau
      io.to(`user_${user_id}`).emit('receive_message', newMessage);
      io.emit('admin_receive_message', newMessage); // Broadcast global untuk notifikasi admin
    } catch (err) {
      console.error('Gagal menyimpan pesan:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
