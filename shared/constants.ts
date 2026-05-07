// G:\project2025\babylonjs\virtual-classroom-v3\shared\constants.ts

export const ROLES = {
    TEACHER: "teacher",
    STUDENT: "student"
};

export const NETWORK_EVENTS = {
    AUTH_JOIN: "auth-join",
    AUTH_ERROR: "auth-error",
    USER_JOINED: "user-joined",
    USER_LEFT: "user-left",
    AVATAR_UPDATE: "avatar-update",
    OFFER: "offer",
    ANSWER: "answer",
    ICE_CANDIDATE: "ice-candidate",
    WHITEBOARD_DRAW: "wb-draw",
    WHITEBOARD_CLEAR: "wb-clear",
    WHITEBOARD_SYNC_REQ: "wb-sync-req",
    WHITEBOARD_SYNC_RES: "wb-sync-res",
    LASER_MOVE: "laser-move"
};

export const AVATAR_CONFIG = {
    SPEED: 0.1,
    ROTATION_SPEED: 0.05,
    DEFAULT_HEIGHT: 1.8,        // Tinggi standar avatar (dalam unit Babylon/meter)
    LABEL_OFFSET: 0.4,          // Jarak floating name tag di atas kepala
    TEACHER_COLOR: "#FFD700",   // Emas (Gold) agar Guru terlihat mentereng
    STUDENT_COLOR: "#00E5FF",   // Biru Muda (Cyan) untuk Siswa
    INTERPOLATION_SPEED: 0.1    // Kecepatan smoothing gerakan saat sinkronisasi
};

// INI DIA YANG KETINGGALAN TADI, MARUDUT!
export const AUDIO_CONFIG = {
    MIN_DISTANCE: 1,      // Suara mulai mengecil setelah 1 meter
    MAX_DISTANCE: 20,     // Suara hilang total setelah 20 meter
    ROLLOFF: 2,           // Kecepatan penurunan suara
    REF_DISTANCE: 1
};