import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: "*",
    credentials: true
}));
app.use(express.json());

// ============================================
// DETEKSI ENVIRONMENT
// ============================================
const hostname = os.hostname();
const isReplit = process.env.REPLIT_ID || process.env.PORT || hostname.includes('replit') || process.cwd().includes('runner');

let server: http.Server | https.Server;

if (isReplit) {
    server = http.createServer(app);
    console.log("🚀 Audio server on HTTP (Replit mode)");
} else {
    try {
        const options = {
            key: fs.readFileSync(join(__dirname, '../../cert/localhost+2-key.pem')),
            cert: fs.readFileSync(join(__dirname, '../../cert/localhost+2.pem')),
        };
        server = https.createServer(options, app);
        console.log("🔐 Audio server on HTTPS (Local mode)");
    } catch (e) {
        server = http.createServer(app);
        console.log("⚠️ Audio server fallback to HTTP");
    }
}

// ============================================
// SOCKET.IO SETUP (AUDIO SERVER)
// ============================================
const io = new Server(server, {
    cors: {
        origin: ["https://pioneer-portal-v3.vercel.app", "http://localhost:5000"],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// ============================================
// AUDIO STATE MANAGEMENT
// ============================================
interface AudioUser {
    uid: string;
    socketId: string;
    displayName: string;
    role: string;
    lastHeartbeat: number;
    position?: { x: number; y: number; z: number };
}

const audioUsers = new Map<string, AudioUser>();
const socketUidMap = new Map<string, string>();

let movementServerSocket: any = null;
const MOVEMENT_SERVER_URL = process.env.MOVEMENT_SERVER_URL || 'http://localhost:8080';

// ============================================
// HEARTBEAT CLEANUP
// ============================================
setInterval(() => {
    const now = Date.now();
    const timeout = 30000;

    audioUsers.forEach((user, uid) => {
        if (now - (user.lastHeartbeat || now) > timeout) {
            console.log(`⏰ Audio timeout untuk ${user.displayName} (${uid})`);
            const socket = io.sockets.sockets.get(user.socketId);
            if (socket) {
                socket.disconnect(true);
            }
            audioUsers.delete(uid);
            socketUidMap.delete(user.socketId);
            io.emit('audio_user_left', uid);
        }
    });
}, 15000);

// ============================================
// ROUTES
// ============================================
app.get('/', (req, res) => {
    res.send("🎧 PIONEER PORTAL V3 AUDIO SERVER IS LIVE!");
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeAudioUsers: audioUsers.size,
        uptime: process.uptime()
    });
});

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', (socket: any) => {
    console.log(`🎧 Audio server connection: ${socket.id}`);

    socket.on('audio_heartbeat', (data: { uid: string, timestamp: number }) => {
        const user = audioUsers.get(data.uid);
        if (user && user.socketId === socket.id) {
            user.lastHeartbeat = Date.now();
            socket.emit('audio_heartbeat_ack', { timestamp: data.timestamp });
        }
    });

    socket.on('register_audio', (data: { uid: string, displayName: string, role: string, movementSocketId?: string }) => {
        const { uid, displayName, role, movementSocketId } = data;

        console.log(`🎤 Registering audio client: ${displayName} (${uid})`);

        socketUidMap.set(socket.id, uid);

        const audioUser: AudioUser = {
            uid: uid,
            socketId: socket.id,
            displayName: displayName,
            role: role,
            lastHeartbeat: Date.now()
        };

        audioUsers.set(uid, audioUser);

        const existingUsers: any = {};
        audioUsers.forEach((user, key) => {
            if (key !== uid) {
                existingUsers[key] = {
                    uid: user.uid,
                    displayName: user.displayName,
                    role: user.role
                };
            }
        });
        socket.emit('audio_current_users', existingUsers);

        socket.broadcast.emit('audio_user_joined', {
            uid: uid,
            displayName: displayName,
            role: role
        });

        console.log(`✅ Audio client registered. Total audio users: ${audioUsers.size}`);
    });

    socket.on('audio_offer', (data: { offer: any, toUid: string }) => {
        const uid = socketUidMap.get(socket.id);
        const target = audioUsers.get(data.toUid);

        if (target && uid) {
            io.to(target.socketId).emit('audio_offer', {
                offer: data.offer,
                from: uid
            });
            console.log(`📞 Audio offer from ${uid} to ${data.toUid}`);
        }
    });

    socket.on('audio_answer', (data: { answer: any, toUid: string }) => {
        const uid = socketUidMap.get(socket.id);
        const target = audioUsers.get(data.toUid);

        if (target && uid) {
            io.to(target.socketId).emit('audio_answer', {
                answer: data.answer,
                from: uid
            });
        }
    });

    socket.on('audio_ice_candidate', (data: { candidate: any, toUid: string }) => {
        const uid = socketUidMap.get(socket.id);
        const target = audioUsers.get(data.toUid);

        if (target && uid) {
            io.to(target.socketId).emit('audio_ice_candidate', {
                candidate: data.candidate,
                from: uid
            });
        }
    });

    socket.on('audio_position_update', (data: { uid: string, position: { x: number, y: number, z: number } }) => {
        const user = audioUsers.get(data.uid);
        if (user && user.socketId === socket.id) {
            user.position = data.position;

            socket.broadcast.emit('audio_position_update', {
                uid: data.uid,
                position: data.position
            });
        }
    });

    socket.on('disconnect', () => {
        const uid = socketUidMap.get(socket.id);

        if (uid) {
            const user = audioUsers.get(uid);
            if (user && user.socketId === socket.id) {
                console.log(`🔇 Audio client disconnected: ${user.displayName} (${uid})`);
                audioUsers.delete(uid);
                io.emit('audio_user_left', uid);
            }
        }

        socketUidMap.delete(socket.id);
    });
});

// ============================================
// SERVER START
// ============================================
const AUDIO_PORT = Number(process.env.PORT) || 8081;
server.listen({
    port: AUDIO_PORT,
    host: '0.0.0.0'
}, () => {
    console.log("🚀 SERVER ONLINE");
    console.log("--------------------------------------------------");
    console.log("🎧 PIONEER PORTAL V3 AUDIO SERVER ONLINE");
    console.log(`📡 Port: ${AUDIO_PORT}`);
    console.log(`🌍 Mode: ${isReplit ? 'REPLIT CLOUD' : 'LOCAL'}`);
    console.log("--------------------------------------------------");
});