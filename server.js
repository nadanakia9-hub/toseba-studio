const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Koneksi Database
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'antrian_photobooth'
});

db.connect((err) => {
    if (err) throw err;
    console.log('Berhasil terhubung ke database MySQL!');
});

// 1. Landing Page Utama
app.get('/', (req, res) => {
    res.render('index');
});

// 2. Halaman Pemesanan Pelanggan (Lantai 1)
app.get('/order', (req, res) => {
    db.query('SELECT * FROM services', (err, services) => {
        if (err) return res.status(500).send('Database error');
        res.render('order', { services });
    });
});

// 3. Submit Order Baru (QRIS atau Cash)
app.post('/checkout', (req, res) => {
    const { customer_name, service_id, extra_persons, payment_method } = req.body;
    const extraCount = parseInt(extra_persons) || 0;
    const extraFee = extraCount * 35000;
    const method = payment_method || 'qris';

    db.query('SELECT * FROM services WHERE id = ?', [service_id], (err, results) => {
        if (err || results.length === 0) return res.status(400).send('Layanan tidak ditemukan.');
        
        const service = results[0];
        const totalPrice = service.price + extraFee;

        db.query(
            'INSERT INTO transactions (customer_name, service_id, total_amount, payment_method, payment_status, queue_status) VALUES (?, ?, ?, ?, "pending", "waiting")',
            [customer_name, service_id, totalPrice, method],
            (err, insertRes) => {
                if (err) return res.status(500).send('Gagal membuat pesanan.');

                if (method === 'cash') {
                    res.render('payment_cash', {
                        orderId: insertRes.insertId,
                        customerName: customer_name,
                        serviceName: service.name,
                        extraCount: extraCount,
                        totalPrice: totalPrice
                    });
                } else {
                    res.render('payment_pending', {
                        orderId: insertRes.insertId,
                        customerName: customer_name,
                        serviceName: service.name,
                        extraCount: extraCount,
                        totalPrice: totalPrice
                    });
                }
            }
        );
    });
});

// 4. Dashboard Kasir (Lantai 1 - Verifikasi Pembayaran & Panggil Antrean)
app.get('/admin', (req, res) => {
    db.query(
        `SELECT t.*, s.name as service_name 
         FROM transactions t 
         JOIN services s ON t.service_id = s.id 
         ORDER BY t.id DESC`, 
        (err, transactions) => {
            if (err) return res.status(500).send('Database error');
            res.render('admin', { transactions });
        }
    );
});

// 5. Action Kasir: Konfirmasi Pembayaran & Terbitkan Nomor Antrean
app.post('/admin/confirm-payment/:id', (req, res) => {
    const transactionId = req.params.id;

    db.query('SELECT MAX(queue_number) AS max_queue FROM transactions WHERE payment_status = "paid"', (err, queueRes) => {
        if (err) return res.status(500).send('Database error');

        const nextQueue = (queueRes[0].max_queue || 0) + 1;

        db.query(
            'UPDATE transactions SET payment_status = "paid", queue_number = ? WHERE id = ?',
            [nextQueue, transactionId],
            (err, updateRes) => {
                if (err) return res.status(500).send('Gagal mengonfirmasi pembayaran.');

                db.query('SELECT * FROM transactions WHERE id = ?', [transactionId], (err, trx) => {
                    // Sinyal ke Display Lantai 3
                    io.emit('new_queue', {
                        queue_number: nextQueue,
                        customer_name: trx[0].customer_name
                    });

                    // Sinyal khusus ke HP Pelanggan
                    io.emit('payment_approved', {
                        id: trx[0].id,
                        queue_number: nextQueue,
                        customer_name: trx[0].customer_name
                    });

                    res.redirect('/admin');
                });
            }
        );
    });
});

// 6. Halaman Display Studio (TV Lantai 3)
app.get('/display', (req, res) => {
    res.render('display');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Toseba Studio berjalan di http://localhost:${PORT}`);
});