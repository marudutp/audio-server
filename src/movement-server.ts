import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import { ROLES, NETWORK_EVENTS } from './constants.js';
import os from 'os';
import cors from 'cors';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();

// ============================================
// KONFIGURASI ADMIN CREDENTIALS
// ============================================
const ADMIN_CREDENTIALS: Record<string, { password: string; displayName: string; uid: string }> = {
  "admin1": {
    "password": "123456",
    "displayName": "Admin Utama",
    "uid": "admin_001"
  },
  "admin2": {
    "password": "000000",
    "displayName": "Admin Sekunder",
    "uid": "admin_002"
  },
  "admin3": {
    "password": "999999",
    "displayName": "Admin Tersier",
    "uid": "admin_003"
  }
};

// ============================================
// SETUP UPLOAD DIRECTORY
// ============================================
const uploadDir = path.join(__dirname, '../public/presentations');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `slide-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: "*",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/presentations', express.static(path.join(__dirname, '../public/presentations')));

// ============================================
// DETEKSI ENVIRONMENT
// ============================================
const hostname = os.hostname();
const isReplit = process.env.REPLIT_ID || process.env.PORT || hostname.includes('replit') || process.cwd().includes('runner');

let server: http.Server | https.Server;

if (isReplit) {
  server = http.createServer(app);
  console.log("🚀 [SADAR MODE] REPLIT DETECTED! Running on HTTP");
} else {
  try {
    const options = {
      key: fs.readFileSync(path.join(__dirname, '../../cert/localhost+2-key.pem')),
      cert: fs.readFileSync(path.join(__dirname, '../../cert/localhost+2.pem')),
    };
    server = https.createServer(options, app);
    console.log("🛠️ LOCAL MODE: Running on HTTPS");
  } catch (e) {
    server = http.createServer(app);
    console.log("⚠️ Cert gak ada, fallback ke HTTP");
  }
}

// ============================================
// SOCKET.IO SETUP (MOVEMENT SERVER)
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
// GAME STATE MANAGEMENT
// ============================================
interface PlayerData {
  uid: string;
  socketId: string;
  displayName: string;
  role: string;
  model: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  lastUpdate: number;
  lastHeartbeat: number;
  audioSocketId?: string;
}

const activeUsers = new Map<string, PlayerData>();
let currentTeacherId: string | null = null;
const MAX_STUDENTS = 10;

const socketUidMap = new Map<string, string>();

const broadcastCapacity = () => {
  const studentCount = Array.from(activeUsers.values()).filter(u => u.role !== ROLES.TEACHER).length;
  io.emit('capacityUpdate', {
    current: studentCount,
    max: MAX_STUDENTS
  });
  console.log(`📊 Kapasitas Update: ${studentCount}/${MAX_STUDENTS}`);
};

// ============================================
// MIDDLEWARE VERIFIKASI TOKEN
// ============================================
function verifyAdminToken(req: any, res: any, next: any) {
  const token = req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [username, timestamp] = decoded.split(':');

    if (ADMIN_CREDENTIALS[username]) {
      req.adminUser = username;
      next();
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============================================
// ROUTES API
// ============================================

app.get('/', (req, res) => {
  console.log("🔔 Seseorang mengetok pintu server (Route / diakses)");
  res.send("🚀 PIONEER PORTAL V3 MOVEMENT SERVER IS LIVE!");
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  console.log(`🔐 Admin login attempt: ${username}`);

  const admin = ADMIN_CREDENTIALS[username];

  if (admin && admin.password === password) {
    const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');

    res.json({
      success: true,
      token: token,
      admin: {
        username: username,
        displayName: admin.displayName,
        uid: admin.uid,
        role: ROLES.TEACHER
      }
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Username atau password salah!'
    });
  }
});

app.post('/api/admin/register', verifyAdminToken, (req, res) => {
  const { socketId, uid, displayName } = req.body;

  console.log(`📝 Registering admin: ${displayName} (${uid}) with socket: ${socketId}`);

  const adminSocket = io.sockets.sockets.get(socketId);

  if (!adminSocket) {
    console.error(`❌ Socket not found: ${socketId}`);
    return res.status(404).json({ success: false, message: 'Socket not found' });
  }

  socketUidMap.set(socketId, uid);

  const adminUser: PlayerData = {
    uid: uid,
    socketId: socketId,
    displayName: `${displayName}`,
    role: ROLES.TEACHER,
    model: "yeti",
    x: 0, y: -0.9, z: 0,
    rotation: Math.PI,
    lastUpdate: Date.now(),
    lastHeartbeat: Date.now()
  };

  activeUsers.set(uid, adminUser);

  if (!currentTeacherId) {
    currentTeacherId = uid;
  }

  console.log(`👨‍🏫 Admin registered as TEACHER: ${displayName} (${uid})`);
  broadcastCapacity();

  res.json({ success: true });
});

app.get('/api/admin/users', verifyAdminToken, (req, res) => {
  const users = Array.from(activeUsers.values());
  res.json(users);
});

app.post('/upload-material', upload.single('slide'), (req, res) => {
  try {
    if (!(req as any).file) {
      return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    }

    const file = (req as any).file;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const fileUrl = `https://${host}/presentations/${file.filename}`;

    console.log("🚀 File berhasil disimpan:", fileUrl);
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("❌ Error Server:", error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// ============================================
// HEARTBEAT CLEANUP
// ============================================
setInterval(() => {
  const now = Date.now();
  const timeout = 30000;

  activeUsers.forEach((player, uid) => {
    if (now - (player.lastHeartbeat || now) > timeout) {
      console.log(`⏰ Heartbeat timeout untuk ${player.displayName} (${uid})`);
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.disconnect(true);
      }
      activeUsers.delete(uid);
      socketUidMap.delete(player.socketId);

      if (uid === currentTeacherId) {
        currentTeacherId = null;
        console.log("⚠️ Guru timeout, dihapus dari kelas");
      }

      io.emit(NETWORK_EVENTS.USER_LEFT, uid);
      broadcastCapacity();
    }
  });
}, 15000);

// ============================================
// SOCKET.IO EVENT HANDLERS
// ============================================

io.on('connection', (socket: any) => {
  console.log(`🔌 Movement server connection: ${socket.id}`);

  socket.on('heartbeat', (data: { uid: string, timestamp: number }) => {
    const player = activeUsers.get(data.uid);
    if (player && player.socketId === socket.id) {
      player.lastHeartbeat = Date.now();
      socket.emit('heartbeat_ack', { timestamp: data.timestamp });
    }
  });

  socket.on('register_audio_socket', (data: { uid: string, audioSocketId: string }) => {
    const player = activeUsers.get(data.uid);
    if (player && player.socketId === socket.id) {
      player.audioSocketId = data.audioSocketId;
      console.log(`🎧 Audio socket registered for ${player.displayName}: ${data.audioSocketId}`);
    }
  });

  socket.on(NETWORK_EVENTS.AUTH_JOIN, (data: any) => {
    const { uid, displayName, avatarModel, role } = data;

    socketUidMap.set(socket.id, uid);

    if (activeUsers.has(uid)) {
      const existing = activeUsers.get(uid);
      if (existing && existing.socketId !== socket.id) {
        console.log(`⚠️ Double login detected: ${displayName} (${uid})`);
        socket.emit('kick_duplicate', {
          message: "Akun ini sudah aktif di tab lain. Silakan tutup tab lain terlebih dahulu."
        });
        setTimeout(() => socket.disconnect(), 1000);
        return;
      }
    }

    const currentStudents = Array.from(activeUsers.values()).filter(u => u.role !== ROLES.TEACHER).length;

    if (currentStudents >= MAX_STUDENTS && role !== ROLES.TEACHER) {
      console.log(`🚫 Kelas penuh: Menolak siswa ${displayName}`);
      socket.emit('error_message', {
        title: "Kelas Penuh!",
        message: `Maaf, kapasitas maksimal ${MAX_STUDENTS} siswa sudah tercapai.`
      });
      setTimeout(() => socket.disconnect(), 1000);
      return;
    }

    const playerData: PlayerData = {
      uid: uid,
      socketId: socket.id,
      displayName: displayName,
      role: role,
      model: avatarModel || (role === ROLES.TEACHER ? "yeti" : "frog"),
      x: 0,
      y: -0.9,
      z: 0,
      rotation: Math.PI,
      lastUpdate: Date.now(),
      lastHeartbeat: Date.now()
    };

    activeUsers.set(uid, playerData);

    if (role === ROLES.TEACHER) {
      currentTeacherId = uid;
      console.log(`👨‍🏫 GURU MASUK: ${displayName} (${uid})`);
    } else {
      console.log(`👶 SISWA MASUK: ${displayName} (${uid})`);
    }

    const playersMap: any = {};
    activeUsers.forEach((player, key) => {
      playersMap[key] = {
        uid: player.uid,
        displayName: player.displayName,
        role: player.role,
        x: player.x,
        y: player.y,
        z: player.z,
        ry: player.rotation
      };
    });
    socket.emit('currentPlayers', playersMap);

    socket.broadcast.emit(NETWORK_EVENTS.USER_JOINED, {
      uid: uid,
      displayName: displayName,
      role: role,
      x: playerData.x,
      z: playerData.z,
      ry: playerData.rotation
    });

    broadcastCapacity();
    console.log(`✅ ${displayName} bergabung. Total: ${activeUsers.size} user`);
  });

  socket.on(NETWORK_EVENTS.AVATAR_UPDATE, (data: any) => {
    const uid = socketUidMap.get(socket.id);
    const player = uid ? activeUsers.get(uid) : null;

    if (player && player.socketId === socket.id) {
      if (data.position) {
        player.x = data.position.x;
        player.y = data.position.y;
        player.z = data.position.z;
      }
      if (data.rotation) {
        player.rotation = data.rotation.y || data.rotation.ry || player.rotation;
      }
      player.lastUpdate = Date.now();

      socket.broadcast.emit(NETWORK_EVENTS.AVATAR_UPDATE, {
        uid: uid,
        position: { x: player.x, y: player.y, z: player.z },
        rotation: { y: player.rotation }
      });
    }
  });

  socket.on('drawData', (data: any) => {
    console.log("📥 [SERVER] drawData received:", JSON.stringify(data));
    const uid = socketUidMap.get(socket.id);
    const player = uid ? activeUsers.get(uid) : null;
    console.log(`📥 [SERVER] Sender uid: ${uid}, Role: ${player?.role}`);
    console.log(`📥 [SERVER] Is teacher? ${player?.role === ROLES.TEACHER}`);

    if (player && player.role === ROLES.TEACHER) {
      socket.broadcast.emit('remoteDraw', data);
      console.log("✅ [SERVER] Broadcasting remoteDraw to others...");
      console.log(`📊 Total clients: ${io.sockets.sockets.size}`);
      console.log("✅ [SERVER] Broadcast sent");
    }
  });

  socket.on('clearBoard', () => {
    const uid = socketUidMap.get(socket.id);
    const player = uid ? activeUsers.get(uid) : null;

    if (player && player.role === ROLES.TEACHER) {
      socket.broadcast.emit('clearBoard');
      console.log("🧹 Guru membersihkan papan tulis");
    }
  });

  socket.on(NETWORK_EVENTS.WHITEBOARD_SYNC_REQ, () => {
    if (currentTeacherId) {
      const teacher = activeUsers.get(currentTeacherId);
      if (teacher) {
        io.to(teacher.socketId).emit(NETWORK_EVENTS.WHITEBOARD_SYNC_REQ, { requester: socket.id });
      }
    }
  });

  socket.on(NETWORK_EVENTS.WHITEBOARD_SYNC_RES, (data: any) => {
    io.to(data.to).emit(NETWORK_EVENTS.WHITEBOARD_SYNC_RES, { img: data.img });
  });

  socket.on('admin_broadcast', (message: string) => {
    console.log(`📢 ADMIN BROADCAST: "${message}"`);

    const uid = socketUidMap.get(socket.id);
    let sender = uid ? activeUsers.get(uid) : null;

    if (!sender) {
      for (const [userId, user] of activeUsers) {
        if (user.socketId === socket.id) {
          sender = user;
          socketUidMap.set(socket.id, userId);
          break;
        }
      }
    }

    if (sender && sender.role === ROLES.TEACHER) {
      io.emit('announcement', message);
      console.log(`✅ Broadcast sent to all clients: ${message}`);

      socket.emit('broadcast_confirmation', {
        success: true,
        message: `Broadcast terkirim: "${message}"`
      });
    } else {
      console.log(`⚠️ Non-teacher tried to broadcast: ${uid}`);
      socket.emit('error_message', {
        title: "Akses Ditolak",
        message: "Hanya Guru yang bisa melakukan broadcast."
      });
    }
  });

  socket.on('admin_kick_user', (targetUid: string) => {
    console.log(`🔨 Admin kick command received for: ${targetUid}`);

    const uid = socketUidMap.get(socket.id);
    let sender = uid ? activeUsers.get(uid) : null;

    if (!sender) {
      for (const [userId, user] of activeUsers) {
        if (user.socketId === socket.id) {
          sender = user;
          socketUidMap.set(socket.id, userId);
          break;
        }
      }
    }

    if (sender && sender.role === ROLES.TEACHER) {
      const target = activeUsers.get(targetUid);
      if (target) {
        console.log(`👢 Kicking user: ${target.displayName} (${targetUid})`);

        io.to(target.socketId).emit('error_message', {
          title: "Dikeluarkan oleh Guru",
          message: "Anda telah dikeluarkan dari kelas."
        });

        socket.emit('kick_success', { uid: targetUid, name: target.displayName });

        setTimeout(() => {
          const targetSocket = io.sockets.sockets.get(target.socketId);
          if (targetSocket) {
            targetSocket.disconnect(true);
          }
          activeUsers.delete(targetUid);
          socketUidMap.delete(target.socketId);
          io.emit(NETWORK_EVENTS.USER_LEFT, targetUid);
          broadcastCapacity();
        }, 500);
      } else {
        socket.emit('kick_error', { uid: targetUid, message: 'User not found' });
      }
    } else {
      socket.emit('error_message', {
        title: "Akses Ditolak",
        message: "Hanya Guru yang bisa mengeluarkan siswa."
      });
    }
  });

  socket.on('admin-change-slide', (data: { slideUrl: string }) => {
    console.log(`📸 ADMIN CHANGE SLIDE: ${data.slideUrl}`);

    const uid = socketUidMap.get(socket.id);
    const sender = uid ? activeUsers.get(uid) : null;

    if (sender && sender.role === ROLES.TEACHER) {
      io.emit('update-whiteboard-slide', data);
      console.log(`✅ Slide broadcast to all clients`);
    }
  });

  socket.on('admin_request_stats', () => {
    const studentCount = Array.from(activeUsers.values()).filter(u => u.role !== ROLES.TEACHER).length;
    socket.emit('capacityUpdate', {
      current: studentCount,
      max: MAX_STUDENTS
    });
  });

  socket.on('admin_unregister', (data: { uid: string }) => {
    console.log(`👋 Admin unregister: ${data.uid}`);
    const admin = activeUsers.get(data.uid);
    if (admin) {
      activeUsers.delete(data.uid);
      socketUidMap.delete(admin.socketId);
      if (currentTeacherId === data.uid) {
        currentTeacherId = null;
      }
      io.emit(NETWORK_EVENTS.USER_LEFT, data.uid);
      broadcastCapacity();
    }
  });

  socket.on('admin_test_packet', (data: any) => {
    socket.emit('admin_test_response', { echo: data, timestamp: Date.now() });
  });

  socket.on('disconnect', () => {
    const uid = socketUidMap.get(socket.id);

    if (uid) {
      const player = activeUsers.get(uid);
      if (player && player.socketId === socket.id) {
        console.log(`❌ ${player.displayName} (${player.role}) keluar dari movement server`);

        if (uid === currentTeacherId) {
          currentTeacherId = null;
          console.log("⚠️ Guru meninggalkan kelas!");
        }

        activeUsers.delete(uid);
        io.emit(NETWORK_EVENTS.USER_LEFT, uid);
        broadcastCapacity();
      }
    }

    socketUidMap.delete(socket.id);
  });
});

// ============================================
// SERVER START
// ============================================
const MOVEMENT_PORT = Number(process.env.PORT) || 8080;

server.listen({
  port: MOVEMENT_PORT,
  host: '0.0.0.0'
}, () => {
  console.log("--------------------------------------------------");
  console.log("🚀 PIONEER PORTAL V3 MOVEMENT SERVER ONLINE");
  console.log(`📡 Port: ${MOVEMENT_PORT}`);
  console.log(`🌍 Mode: ${isReplit ? 'REPLIT CLOUD' : 'LOCAL'}`);
  console.log(`👥 Max Students: ${MAX_STUDENTS}`);
  console.log("--------------------------------------------------");
});