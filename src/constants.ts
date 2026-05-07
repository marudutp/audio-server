// shared/constants.ts
export const ROLES = {
    TEACHER: 'teacher',
    STUDENT: 'student'
} as const;

export const NETWORK_EVENTS = {
    AUTH_JOIN: 'auth_join',
    USER_JOINED: 'user_joined',
    USER_LEFT: 'user_left',
    AVATAR_UPDATE: 'avatar_update',
    WHITEBOARD_SYNC_REQ: 'whiteboard_sync_req',
    WHITEBOARD_SYNC_RES: 'whiteboard_sync_res',
    OFFER: 'offer',
    ANSWER: 'answer',
    ICE_CANDIDATE: 'ice_candidate'
} as const;