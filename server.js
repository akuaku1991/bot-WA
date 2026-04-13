const express = require('express');
const { default: makeWASocket, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// GANTI DENGAN LINK MONGODB ANDA (Pastikan <db_password> sudah diganti password asli)
const MONGO_URL = "mongodb+srv://botwa:Akuaku1991@cluster0.l9cw3no.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const dbName = "wa_bot_db";
const collectionName = "auth_session";

let sock;

// Adaptor untuk menyimpan sesi ke MongoDB
async function useMongoDBAuthState(collection) {
    const writeData = async (data, id) => {
        const informationToStore = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await collection.updateOne({ _id: id }, { $set: informationToStore }, { upsert: true });
    };
    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            return data ? JSON.parse(JSON.stringify(data), BufferJSON.reviver) : null;
        } catch (error) { return null; }
    };
    const removeData = async (id) => { await collection.deleteOne({ _id: id }); };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

// Fungsi utama menjalankan bot
async function connectToWA() {
    console.log("Menghubungkan ke MongoDB...");
    const mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    console.log("Berhasil terhubung ke database!");
    
    const collection = mongoClient.db(dbName).collection(collectionName);
    const { state, saveCreds } = await useMongoDBAuthState(collection);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["PanelBot", "Chrome", "1.0.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'close') {
            console.log('Koneksi terputus, menghubungkan ulang...');
            connectToWA();
        } else if (connection === 'open') {
            console.log('WhatsApp Terhubung! Sesi aman di MongoDB.');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWA();

// --- JALUR API UNTUK PANEL CPANEL ---

app.get('/pairing', async (req, res) => {
    const phone = req.query.phone;
    if (!phone) return res.json({ error: 'Nomor HP diperlukan' });
    try {
        await sock.waitForConnectionUpdate((update) => !!update.qr);
        const code = await sock.requestPairingCode(phone);
        res.json({ code: code });
    } catch (err) {
        res.json({ error: 'Gagal mendapatkan kode. Pastikan nomor benar atau bot belum login.' });
    }
});

app.get('/status', (req, res) => {
    if (sock && sock.user) {
        res.json({ status: 'connected', user: sock.user.id });
    } else {
        res.json({ status: 'disconnected' });
    }
});

app.listen(PORT, () => console.log(`Mesin Bot Aktif!`));
