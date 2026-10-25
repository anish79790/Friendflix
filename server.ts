import express, { Request, Response, NextFunction } from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const PORT = 3000;
const SIGNING_SECRET =
  process.env.SESSION_SIGNING_SECRET ||
  crypto.createHash('sha256').update('friendsflix-default-runtime-secret-key-2026').digest('hex');

// Free-Tier Operational Limits
const LIMITS = {
  MAX_ROOM_PARTICIPANTS: Number(process.env.MAX_ROOM_PARTICIPANTS) || 8,
  RECOMMENDED_VOICE_PARTICIPANTS: Number(process.env.RECOMMENDED_VOICE_PARTICIPANTS) || 4,
  MAX_UPLOAD_FILE_SIZE_BYTES: (Number(process.env.MAX_UPLOAD_FILE_SIZE_MB) || 50) * 1024 * 1024,
  MAX_CHAT_MESSAGE_LENGTH: Number(process.env.MAX_CHAT_MESSAGE_LENGTH) || 500,
  IDLE_ROOM_EXPIRY_MS: (Number(process.env.IDLE_ROOM_EXPIRY_MINUTES) || 120) * 60 * 1000,
  SIGNED_URL_TTL_MS: 15 * 60 * 1000, // 15 minutes
};

const UPLOAD_DIR = path.join('/tmp', 'friendsflix-private-uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const PERSIST_FILE = path.join('/tmp', 'friendsflix-state.json');

// Types
export interface ActorIdentity {
  id: string;
  displayName: string;
  avatarUrl: string;
  authType: 'firebase' | 'guest';
}

export interface RoomMemberRecord {
  memberId: string;
  displayName: string;
  avatarUrl: string;
  authType: 'firebase' | 'guest';
  role: 'host' | 'participant' | 'guest';
  joinedAt: string;
  lastSeenAt: string;
  isOnline: boolean;
  inVoice: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
}

export interface MediaItemRecord {
  id: string;
  ownerId: string;
  ownerName: string;
  roomId: string;
  sourceType: 'youtube' | 'upload';
  title: string;
  sourceIdOrPath: string;
  mimeType: string;
  fileSize: number | null;
  createdAt: string;
}

export interface QueueItemRecord {
  id: string;
  roomId: string;
  mediaItemId: string;
  sourceType: 'youtube' | 'upload';
  sourceId: string;
  title: string;
  mimeType?: string;
  fileSize?: number | null;
  position: number;
  addedBy: string;
  addedByName: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  roomId: string;
  senderId: string;
  displayName: string;
  avatarUrl: string;
  message: string;
  reactions: Record<string, string[]>; // emoji -> array of memberIds
  createdAt: string;
  isSystem?: boolean;
}

export interface JoinRequestRecord {
  memberId: string;
  displayName: string;
  avatarUrl: string;
  authType: 'firebase' | 'guest';
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  updatedAt: string;
}

export interface RoomRecord {
  id: string;
  name: string;
  hostId: string;
  originalHostId: string;
  inviteCode: string;
  isPrivate: boolean;
  isLocked: boolean;
  allowParticipantQueue: boolean;
  status: 'active' | 'ended';
  activeMediaId: string;
  activeMediaType: 'youtube' | 'upload' | 'none';
  activeMediaSource: string;
  activeMediaTitle: string;
  playbackPosition: number;
  isPlaying: boolean;
  playbackUpdatedAt: number;
  createdAt: string;
  expiresAt: number;
  members: Record<string, RoomMemberRecord>;
  joinRequests?: Record<string, JoinRequestRecord>;
  mediaItems: Record<string, MediaItemRecord>;
  queue: QueueItemRecord[];
  messages: ChatMessageRecord[];
}

// Authoritative Server Store
const rooms = new Map<string, RoomRecord>();
const inviteCodeToRoomId = new Map<string, string>();
const chatRateLimits = new Map<string, number[]>();
const uploadRateLimits = new Map<string, number[]>();
const hostDisconnectTimers = new Map<string, NodeJS.Timeout>();

function saveStateToDisk() {
  try {
    const serialized = Array.from(rooms.values());
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(serialized), 'utf-8');
  } catch (err) {
    console.error('Failed to persist state snapshot:', err);
  }
}

function loadStateFromDisk() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const raw = fs.readFileSync(PERSIST_FILE, 'utf-8');
      const parsed: RoomRecord[] = JSON.parse(raw);
      const now = Date.now();
      for (const room of parsed) {
        if (room.status === 'active' && room.expiresAt > now) {
          // Reset transient connection flags on server restart
          for (const m of Object.values(room.members)) {
            m.isOnline = false;
            m.inVoice = false;
            m.isSpeaking = false;
          }
          if (!room.joinRequests) {
            room.joinRequests = {};
          }
          rooms.set(room.id, room);
          inviteCodeToRoomId.set(room.inviteCode.toUpperCase(), room.id);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load state snapshot:', err);
  }
}

loadStateFromDisk();

// Cryptographic Session Tokens
function createSessionToken(actor: ActorIdentity): string {
  const payload = Buffer.from(JSON.stringify(actor), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string | undefined): ActorIdentity | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!decoded || typeof decoded.id !== 'string' || typeof decoded.displayName !== 'string') {
      return null;
    }
    return decoded as ActorIdentity;
  } catch {
    return null;
  }
}

// Signed Media URL Helpers
function createSignedMediaToken(roomId: string, mediaId: string, memberId: string, expiresAt: number): string {
  const data = `${roomId}:${mediaId}:${memberId}:${expiresAt}`;
  return crypto.createHmac('sha256', SIGNING_SECRET).update(data).digest('hex');
}

function verifySignedMediaToken(
  roomId: string,
  mediaId: string,
  memberId: string,
  expiresAt: number,
  sig: string
): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = createSignedMediaToken(roomId, mediaId, memberId, expiresAt);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let part1 = '';
  let part2 = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 4; i++) part1 += chars[bytes[i] % chars.length];
  for (let i = 4; i < 8; i++) part2 += chars[bytes[i] % chars.length];
  return `FFX-${part1}-${part2}`;
}

function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function computeCurrentPlaybackPosition(room: RoomRecord): number {
  if (!room.isPlaying) return room.playbackPosition;
  const elapsedSec = Math.max(0, (Date.now() - room.playbackUpdatedAt) / 1000);
  return Number((room.playbackPosition + elapsedSec).toFixed(2));
}

function serializeRoomForClient(room: RoomRecord) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    inviteCode: room.inviteCode,
    isPrivate: room.isPrivate,
    isLocked: room.isLocked,
    allowParticipantQueue: room.allowParticipantQueue,
    status: room.status,
    activeMediaId: room.activeMediaId,
    activeMediaType: room.activeMediaType,
    activeMediaSource: room.activeMediaSource,
    activeMediaTitle: room.activeMediaTitle,
    playbackPosition: computeCurrentPlaybackPosition(room),
    isPlaying: room.isPlaying,
    playbackUpdatedAt: room.playbackUpdatedAt,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    members: Object.values(room.members),
    joinRequests: Object.values(room.joinRequests || {}).filter((r) => r.status === 'pending'),
    mediaItems: Object.values(room.mediaItems).map((m) => ({
      id: m.id,
      ownerId: m.ownerId,
      ownerName: m.ownerName,
      roomId: m.roomId,
      sourceType: m.sourceType,
      title: m.title,
      mimeType: m.mimeType,
      fileSize: m.fileSize,
      createdAt: m.createdAt,
    })),
    queue: room.queue,
    messages: room.messages.slice(-150),
  };
}

// Verify MP4 / WebM Magic Bytes
function verifyVideoMagicBytes(filePath: string, mimeType: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (bytesRead < 12) return false;

    if (mimeType === 'video/mp4') {
      // ISO Base Media File Format has 'ftyp' at bytes 4..7
      const boxType = buffer.subarray(4, 8).toString('ascii');
      return boxType === 'ftyp' || boxType === 'moov' || boxType === 'mdat';
    }
    if (mimeType === 'video/webm') {
      // Matroska / WebM EBML header starts with 0x1A 0x45 0xDF 0xA3
      return (
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      );
    }
    return false;
  } catch {
    return false;
  }
}

// Express Auth Middleware
interface AuthenticatedRequest extends Request {
  actor?: ActorIdentity;
}

function requireActor(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please create or refresh your session.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const actor = verifySessionToken(token);
  if (!actor) {
    res.status(401).json({ error: 'Invalid or expired session token.' });
    return;
  }
  req.actor = actor;
  next();
}

// Periodic Cleanup of Expired Rooms and Private Files
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [roomId, room] of rooms.entries()) {
    if (room.expiresAt < now || (room.status === 'ended' && now - room.playbackUpdatedAt > 10 * 60 * 1000)) {
      for (const media of Object.values(room.mediaItems)) {
        if (media.sourceType === 'upload' && media.sourceIdOrPath && fs.existsSync(media.sourceIdOrPath)) {
          try {
            fs.unlinkSync(media.sourceIdOrPath);
          } catch {
            // ignore unlink errors
          }
        }
      }
      inviteCodeToRoomId.delete(room.inviteCode.toUpperCase());
      rooms.delete(roomId);
      changed = true;
    }
  }
  if (changed) saveStateToDisk();
}, 60 * 1000);

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);

  app.use(express.json({ limit: '1mb' }));

  // 1. Configuration & Free-Tier Status Endpoint
  app.get('/api/config-status', (_req, res) => {
    res.json({
      firebaseConfigured: true,
      realtimeEngine: 'firebase-firestore + websocket-authoritative',
      storageEngine: 'private-signed-media-storage',
      limits: {
        maxRoomParticipants: LIMITS.MAX_ROOM_PARTICIPANTS,
        recommendedVoiceParticipants: LIMITS.RECOMMENDED_VOICE_PARTICIPANTS,
        maxUploadSizeMb: LIMITS.MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024),
        maxChatMessageLength: LIMITS.MAX_CHAT_MESSAGE_LENGTH,
        idleRoomExpiryMinutes: LIMITS.IDLE_ROOM_EXPIRY_MS / (60 * 1000),
      },
    });
  });

  // 2. Create or Update Cryptographic Actor Session
  app.post('/api/auth/session', (req: Request, res: Response) => {
    const displayName = sanitizeText(req.body?.displayName, 40);
    const existingToken = typeof req.body?.existingToken === 'string' ? req.body.existingToken : undefined;
    const externalUid = sanitizeText(req.body?.externalUid, 128);
    const authType = req.body?.authType === 'firebase' ? 'firebase' : 'guest';
    const avatarUrl = sanitizeText(req.body?.avatarUrl, 500);

    if (!displayName || displayName.length < 2) {
      res.status(400).json({ error: 'Display name must be between 2 and 40 characters.' });
      return;
    }

    const existingActor = verifySessionToken(existingToken);
    let actorId: string;

    if (authType !== 'guest' && externalUid && /^[a-zA-Z0-9_\-]+$/.test(externalUid)) {
      actorId = `${authType}_${externalUid}`;
    } else if (existingActor && existingActor.authType === 'guest') {
      actorId = existingActor.id;
    } else {
      actorId = `guest_${crypto.randomBytes(10).toString('hex')}`;
    }

    const actor: ActorIdentity = {
      id: actorId,
      displayName,
      avatarUrl: avatarUrl || '',
      authType,
    };

    // Update displayName in any active rooms this actor is part of
    for (const room of rooms.values()) {
      if (room.members[actor.id]) {
        room.members[actor.id].displayName = actor.displayName;
        if (actor.avatarUrl) room.members[actor.id].avatarUrl = actor.avatarUrl;
      }
    }

    const token = createSessionToken(actor);
    res.json({ actor, token });
  });

  // 3. Create Room
  app.post('/api/rooms', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const roomName = sanitizeText(req.body?.name, 80);
    const isPrivate = req.body?.isPrivate !== false; // True by default
    const customInviteCode = sanitizeText(req.body?.customInviteCode, 16).toUpperCase();
    const initialYoutubeId = sanitizeText(req.body?.initialYoutubeId, 32);
    const initialYoutubeTitle = sanitizeText(req.body?.initialYoutubeTitle, 160);

    if (!roomName || roomName.length < 2) {
      res.status(400).json({ error: 'Room name must be between 2 and 80 characters.' });
      return;
    }

    const roomId = `rm_${crypto.randomBytes(8).toString('hex')}`;
    let inviteCode =
      customInviteCode && /^[A-Z0-9\-]{6,16}$/.test(customInviteCode) && !inviteCodeToRoomId.has(customInviteCode)
        ? customInviteCode
        : generateInviteCode();
    while (inviteCodeToRoomId.has(inviteCode)) {
      inviteCode = generateInviteCode();
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    const defaultVideoId = initialYoutubeId && /^[a-zA-Z0-9_-]{11}$/.test(initialYoutubeId) ? initialYoutubeId : '';
    const defaultTitle = defaultVideoId ? initialYoutubeTitle || 'Featured Watch Party Video' : '';

    const initialMediaId = defaultVideoId ? `med_${crypto.randomBytes(6).toString('hex')}` : '';

    const room: RoomRecord = {
      id: roomId,
      name: roomName,
      hostId: actor.id,
      originalHostId: actor.id,
      inviteCode,
      isPrivate,
      isLocked: false,
      allowParticipantQueue: false,
      status: 'active',
      activeMediaId: initialMediaId,
      activeMediaType: defaultVideoId ? 'youtube' : 'none',
      activeMediaSource: defaultVideoId,
      activeMediaTitle: defaultTitle,
      playbackPosition: 0,
      isPlaying: false,
      playbackUpdatedAt: nowMs,
      createdAt: nowIso,
      expiresAt: nowMs + LIMITS.IDLE_ROOM_EXPIRY_MS,
      members: {
        [actor.id]: {
          memberId: actor.id,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
          authType: actor.authType,
          role: 'host',
          joinedAt: nowIso,
          lastSeenAt: nowIso,
          isOnline: true,
          inVoice: false,
          isMuted: false,
          isSpeaking: false,
        },
      },
      joinRequests: {},
      mediaItems: {},
      queue: [],
      messages: [
        {
          id: `msg_${crypto.randomBytes(6).toString('hex')}`,
          roomId,
          senderId: 'system',
          displayName: 'FriendsFlix',
          avatarUrl: '',
          message: `${actor.displayName} created "${roomName}". Unique Room Code: ${inviteCode} (${
            isPrivate ? 'Private Room — Join by Request' : 'Public Room — Direct Join'
          }).`,
          reactions: {},
          createdAt: nowIso,
          isSystem: true,
        },
      ],
    };

    if (defaultVideoId && initialMediaId) {
      room.mediaItems[initialMediaId] = {
        id: initialMediaId,
        ownerId: actor.id,
        ownerName: actor.displayName,
        roomId,
        sourceType: 'youtube',
        title: defaultTitle,
        sourceIdOrPath: defaultVideoId,
        mimeType: 'video/youtube',
        fileSize: null,
        createdAt: nowIso,
      };
      room.queue.push({
        id: `q_${crypto.randomBytes(6).toString('hex')}`,
        roomId,
        mediaItemId: initialMediaId,
        sourceType: 'youtube',
        sourceId: defaultVideoId,
        title: defaultTitle,
        position: 0,
        addedBy: actor.id,
        addedByName: actor.displayName,
        createdAt: nowIso,
      });
    }

    rooms.set(roomId, room);
    inviteCodeToRoomId.set(inviteCode.toUpperCase(), roomId);
    saveStateToDisk();

    res.status(201).json({ room: serializeRoomForClient(room) });
  });

  // 4. Join Room via Unique Invite Code (Public = Direct Join, Private = Send Join Request to Host)
  app.post('/api/rooms/join', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const rawCodeOrInput = sanitizeText(req.body?.inviteCode || req.body?.roomCodeOrLink, 250);
    const explicitRoomId = sanitizeText(req.body?.roomId, 64);

    if (!rawCodeOrInput && !explicitRoomId) {
      res.status(400).json({ error: 'Please provide a valid room code or invite link.' });
      return;
    }

    const lowerRaw = rawCodeOrInput.toLowerCase();
    if (lowerRaw.includes('youtube.com/') || lowerRaw.includes('youtu.be/')) {
      res.status(400).json({
        error:
          'That is a YouTube video link! Please enter your friend’s Unique Room Joining Code (e.g. FFX-7K9M-4P2X) here. You can paste YouTube links inside the room’s video player.',
      });
      return;
    }

    // Parse if user pasted a full URL or room code
    let parsedRoomId = explicitRoomId;
    let parsedInviteCode = rawCodeOrInput.toUpperCase();

    if (rawCodeOrInput.includes('http://') || rawCodeOrInput.includes('https://') || rawCodeOrInput.includes('?')) {
      try {
        const urlObj = new URL(
          rawCodeOrInput.startsWith('http') ? rawCodeOrInput : `http://localhost/${rawCodeOrInput}`
        );
        const rParam = urlObj.searchParams.get('room');
        const cParam = urlObj.searchParams.get('code');
        if (rParam) parsedRoomId = rParam.trim();
        if (cParam) parsedInviteCode = cParam.trim().toUpperCase();
      } catch {
        // Fallback to raw code
      }
    }

    let targetRoom: RoomRecord | undefined;
    if (parsedInviteCode && inviteCodeToRoomId.has(parsedInviteCode)) {
      const mappedId = inviteCodeToRoomId.get(parsedInviteCode)!;
      targetRoom = rooms.get(mappedId);
    } else if (parsedRoomId && rooms.has(parsedRoomId)) {
      targetRoom = rooms.get(parsedRoomId);
    } else if (rooms.has(rawCodeOrInput)) {
      targetRoom = rooms.get(rawCodeOrInput);
    }

    if (!targetRoom) {
      res.status(404).json({ error: 'Room not found. Check the unique Room Code or ask the host for a fresh code.' });
      return;
    }

    if (targetRoom.status === 'ended' || Date.now() > targetRoom.expiresAt) {
      res.status(410).json({ error: 'This watch room has expired or been ended by the host.' });
      return;
    }

    if (!targetRoom.joinRequests) {
      targetRoom.joinRequests = {};
    }

    const isExistingMember = Boolean(targetRoom.members[actor.id]) || targetRoom.hostId === actor.id;

    // Enforce Locked Room Check
    if (targetRoom.isLocked && !isExistingMember) {
      res.status(423).json({ error: 'This room is currently locked by the host and not accepting new members.' });
      return;
    }

    // Enforce Maximum Room Size (8 Participants)
    const currentMemberCount = Object.keys(targetRoom.members).length;
    if (!isExistingMember && currentMemberCount >= LIMITS.MAX_ROOM_PARTICIPANTS) {
      res.status(429).json({
        error: `This room is full (maximum ${LIMITS.MAX_ROOM_PARTICIPANTS} participants on the free tier).`,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    targetRoom.expiresAt = Date.now() + LIMITS.IDLE_ROOM_EXPIRY_MS;

    // If user is already an active member or host, let them right back in
    if (isExistingMember) {
      if (targetRoom.members[actor.id]) {
        targetRoom.members[actor.id].displayName = actor.displayName;
        targetRoom.members[actor.id].lastSeenAt = nowIso;
        targetRoom.members[actor.id].isOnline = true;
      }
      saveStateToDisk();
      broadcastToRoom(targetRoom.id, {
        type: 'presence:sync',
        members: Object.values(targetRoom.members),
      });
      res.json({ status: 'joined', room: serializeRoomForClient(targetRoom) });
      return;
    }

    // PRIVATE ROOM: Require valid invite code AND send a Join Request to the Host for approval
    if (targetRoom.isPrivate) {
      if (!parsedInviteCode || parsedInviteCode !== targetRoom.inviteCode.toUpperCase()) {
        res.status(403).json({
          error: 'This room is private. Please enter the room’s unique invite code to send a join request.',
        });
        return;
      }

      const existingRequest = targetRoom.joinRequests[actor.id];
      if (existingRequest && existingRequest.status === 'approved') {
        targetRoom.members[actor.id] = {
          memberId: actor.id,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
          authType: actor.authType,
          role: actor.authType === 'guest' ? 'guest' : 'participant',
          joinedAt: nowIso,
          lastSeenAt: nowIso,
          isOnline: true,
          inVoice: false,
          isMuted: false,
          isSpeaking: false,
        };
        delete targetRoom.joinRequests[actor.id];
        saveStateToDisk();
        broadcastToRoom(targetRoom.id, {
          type: 'member:joined',
          member: targetRoom.members[actor.id],
          members: Object.values(targetRoom.members),
          joinRequests: Object.values(targetRoom.joinRequests).filter((r) => r.status === 'pending'),
        });
        res.json({ status: 'joined', room: serializeRoomForClient(targetRoom) });
        return;
      }

      targetRoom.joinRequests[actor.id] = {
        memberId: actor.id,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
        authType: actor.authType,
        status: 'pending',
        requestedAt: existingRequest?.requestedAt || nowIso,
        updatedAt: nowIso,
      };

      saveStateToDisk();
      broadcastToRoom(targetRoom.id, {
        type: 'room:join_requests_updated',
        joinRequests: Object.values(targetRoom.joinRequests).filter((r) => r.status === 'pending'),
        requesterName: actor.displayName,
      });

      res.status(202).json({
        status: 'pending_approval',
        roomId: targetRoom.id,
        roomName: targetRoom.name,
        inviteCode: targetRoom.inviteCode,
        message: 'Join request sent to the room host! Waiting for host approval...',
      });
      return;
    }

    // PUBLIC ROOM: Join directly without waiting for host approval!
    targetRoom.members[actor.id] = {
      memberId: actor.id,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      authType: actor.authType,
      role: actor.authType === 'guest' ? 'guest' : 'participant',
      joinedAt: nowIso,
      lastSeenAt: nowIso,
      isOnline: true,
      inVoice: false,
      isMuted: false,
      isSpeaking: false,
    };

    const joinMsg: ChatMessageRecord = {
      id: `msg_${crypto.randomBytes(6).toString('hex')}`,
      roomId: targetRoom.id,
      senderId: 'system',
      displayName: 'FriendsFlix',
      avatarUrl: '',
      message: `${actor.displayName} joined the room directly via code ${targetRoom.inviteCode}.`,
      reactions: {},
      createdAt: nowIso,
      isSystem: true,
    };
    targetRoom.messages.push(joinMsg);
    saveStateToDisk();

    broadcastToRoom(targetRoom.id, {
      type: 'member:joined',
      member: targetRoom.members[actor.id],
      members: Object.values(targetRoom.members),
      systemMessage: joinMsg,
    });

    res.json({ status: 'joined', room: serializeRoomForClient(targetRoom) });
  });

  // 4b. Poll Private Room Join Request Status
  app.get('/api/rooms/:roomId/join-status', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    if (!room || room.status === 'ended') {
      res.status(404).json({ status: 'rejected', error: 'Room was ended or no longer exists.' });
      return;
    }

    if (room.members[actor.id] || room.hostId === actor.id) {
      res.json({ status: 'approved', room: serializeRoomForClient(room) });
      return;
    }

    const reqRecord = room.joinRequests?.[actor.id];
    if (!reqRecord) {
      res.json({ status: 'pending' });
      return;
    }

    if (reqRecord.status === 'approved') {
      const nowIso = new Date().toISOString();
      room.members[actor.id] = {
        memberId: actor.id,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
        authType: actor.authType,
        role: actor.authType === 'guest' ? 'guest' : 'participant',
        joinedAt: nowIso,
        lastSeenAt: nowIso,
        isOnline: true,
        inVoice: false,
        isMuted: false,
        isSpeaking: false,
      };
      delete room.joinRequests![actor.id];
      saveStateToDisk();
      broadcastToRoom(room.id, {
        type: 'member:joined',
        member: room.members[actor.id],
        members: Object.values(room.members),
        joinRequests: Object.values(room.joinRequests || {}).filter((r) => r.status === 'pending'),
      });
      res.json({ status: 'approved', room: serializeRoomForClient(room) });
      return;
    }

    if (reqRecord.status === 'rejected') {
      res.json({ status: 'rejected', error: 'Your join request was declined by the room host.' });
      return;
    }

    res.json({ status: 'pending' });
  });

  // 4c. Host Approve or Reject Private Room Join Request
  app.post(
    '/api/rooms/:roomId/join-requests/:targetMemberId/respond',
    requireActor,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.actor!;
      const room = rooms.get(req.params.roomId);
      const targetMemberId = sanitizeText(req.params.targetMemberId, 128);
      const action = req.body?.action === 'reject' ? 'reject' : 'approve';

      if (!room || room.status === 'ended') {
        res.status(404).json({ error: 'Active room not found.' });
        return;
      }
      if (room.hostId !== actor.id) {
        res.status(403).json({ error: 'Only the room host can approve or decline join requests.' });
        return;
      }
      if (!room.joinRequests) {
        room.joinRequests = {};
      }

      const targetReq = room.joinRequests[targetMemberId];
      if (!targetReq) {
        res.status(404).json({ error: 'Join request not found or already handled.' });
        return;
      }

      const nowIso = new Date().toISOString();

      if (action === 'approve') {
        if (Object.keys(room.members).length >= LIMITS.MAX_ROOM_PARTICIPANTS) {
          res.status(429).json({ error: `Room is full (max ${LIMITS.MAX_ROOM_PARTICIPANTS} participants).` });
          return;
        }

        targetReq.status = 'approved';
        targetReq.updatedAt = nowIso;

        room.members[targetMemberId] = {
          memberId: targetReq.memberId,
          displayName: targetReq.displayName,
          avatarUrl: targetReq.avatarUrl,
          authType: targetReq.authType,
          role: targetReq.authType === 'guest' ? 'guest' : 'participant',
          joinedAt: nowIso,
          lastSeenAt: nowIso,
          isOnline: true,
          inVoice: false,
          isMuted: false,
          isSpeaking: false,
        };
        delete room.joinRequests[targetMemberId];

        const approveMsg: ChatMessageRecord = {
          id: `msg_${crypto.randomBytes(6).toString('hex')}`,
          roomId: room.id,
          senderId: 'system',
          displayName: 'FriendsFlix',
          avatarUrl: '',
          message: `${targetReq.displayName}'s join request was approved by the host.`,
          reactions: {},
          createdAt: nowIso,
          isSystem: true,
        };
        room.messages.push(approveMsg);
        saveStateToDisk();

        broadcastToRoom(room.id, {
          type: 'member:joined',
          member: room.members[targetMemberId],
          members: Object.values(room.members),
          joinRequests: Object.values(room.joinRequests).filter((r) => r.status === 'pending'),
          systemMessage: approveMsg,
        });
      } else {
        targetReq.status = 'rejected';
        targetReq.updatedAt = nowIso;
        saveStateToDisk();

        broadcastToRoom(room.id, {
          type: 'room:join_requests_updated',
          joinRequests: Object.values(room.joinRequests).filter((r) => r.status === 'pending'),
        });
      }

      res.json({ room: serializeRoomForClient(room) });
    }
  );

  // 5. Get Authorized Room State
  app.get('/api/rooms/:roomId', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);

    if (!room) {
      res.status(404).json({ error: 'Room does not exist or has been deleted.' });
      return;
    }
    if (room.status === 'ended' || Date.now() > room.expiresAt) {
      res.status(410).json({ error: 'This watch room has expired or ended.' });
      return;
    }

    // Strict Membership Check
    if (!room.members[actor.id] && room.hostId !== actor.id) {
      res.status(403).json({
        error: 'Access denied. You must join this private room with a valid invite before viewing room data.',
      });
      return;
    }

    res.json({ room: serializeRoomForClient(room) });
  });

  // 6. Host Settings & Moderation Endpoints
  app.patch('/api/rooms/:roomId/settings', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the room host can modify room settings.' });
      return;
    }

    if (typeof req.body?.name === 'string') {
      const cleanName = sanitizeText(req.body.name, 80);
      if (cleanName.length >= 2) room.name = cleanName;
    }
    if (typeof req.body?.isPrivate === 'boolean') room.isPrivate = req.body.isPrivate;
    if (typeof req.body?.isLocked === 'boolean') room.isLocked = req.body.isLocked;
    if (typeof req.body?.allowParticipantQueue === 'boolean') {
      room.allowParticipantQueue = req.body.allowParticipantQueue;
    }

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'room:settings_updated',
      name: room.name,
      isPrivate: room.isPrivate,
      isLocked: room.isLocked,
      allowParticipantQueue: room.allowParticipantQueue,
    });

    res.json({ room: serializeRoomForClient(room) });
  });

  // Transfer Host Ownership
  app.post('/api/rooms/:roomId/transfer-host', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    const targetMemberId = sanitizeText(req.body?.targetMemberId, 128);

    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the current host can transfer room ownership.' });
      return;
    }
    const targetMember = room.members[targetMemberId];
    if (!targetMember) {
      res.status(404).json({ error: 'Selected participant is not a member of this room.' });
      return;
    }

    if (room.members[actor.id]) {
      room.members[actor.id].role = room.members[actor.id].authType === 'guest' ? 'guest' : 'participant';
    }
    targetMember.role = 'host';
    room.hostId = targetMember.memberId;

    const sysMsg: ChatMessageRecord = {
      id: `msg_${crypto.randomBytes(6).toString('hex')}`,
      roomId: room.id,
      senderId: 'system',
      displayName: 'FriendsFlix',
      avatarUrl: '',
      message: `${actor.displayName} transferred host controls to ${targetMember.displayName}.`,
      reactions: {},
      createdAt: new Date().toISOString(),
      isSystem: true,
    };
    room.messages.push(sysMsg);

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'room:host_transferred',
      hostId: room.hostId,
      members: Object.values(room.members),
      systemMessage: sysMsg,
    });

    res.json({ room: serializeRoomForClient(room) });
  });

  // Remove / Kick Participant
  app.post('/api/rooms/:roomId/kick', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    const targetMemberId = sanitizeText(req.body?.targetMemberId, 128);

    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the host can remove a participant.' });
      return;
    }
    if (targetMemberId === actor.id) {
      res.status(400).json({ error: 'Host cannot kick themselves.' });
      return;
    }

    const removed = room.members[targetMemberId];
    if (!removed) {
      res.status(404).json({ error: 'Participant not found.' });
      return;
    }

    delete room.members[targetMemberId];
    saveStateToDisk();

    // Notify and close kicked participant's socket
    broadcastToRoom(room.id, {
      type: 'member:kicked',
      targetMemberId,
      members: Object.values(room.members),
    });
    disconnectMemberSockets(room.id, targetMemberId);

    res.json({ room: serializeRoomForClient(room) });
  });

  // End Room
  app.post('/api/rooms/:roomId/end', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);

    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the host can end the room.' });
      return;
    }

    room.status = 'ended';
    room.isPlaying = false;
    room.playbackUpdatedAt = Date.now();

    // Delete uploaded files for this ended room
    for (const media of Object.values(room.mediaItems)) {
      if (media.sourceType === 'upload' && media.sourceIdOrPath && fs.existsSync(media.sourceIdOrPath)) {
        try {
          fs.unlinkSync(media.sourceIdOrPath);
        } catch {
          // ignore
        }
      }
    }

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'room:ended',
      endedBy: actor.displayName,
    });

    res.json({ status: 'ended' });
  });

  // 7. Shared Queue Management
  app.post('/api/rooms/:roomId/queue', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (!room.members[actor.id]) {
      res.status(403).json({ error: 'Room membership required.' });
      return;
    }
    if (room.hostId !== actor.id && !room.allowParticipantQueue) {
      res.status(403).json({ error: 'Only the host can add items to the queue in this room.' });
      return;
    }

    const sourceType = req.body?.sourceType === 'upload' ? 'upload' : 'youtube';
    const sourceId = sanitizeText(req.body?.sourceId, 500);
    const title = sanitizeText(req.body?.title, 200) || 'Untitled Video';
    const playImmediately = Boolean(req.body?.playImmediately);

    if (!sourceId) {
      res.status(400).json({ error: 'Valid media source ID is required.' });
      return;
    }

    if (sourceType === 'youtube' && !/^[a-zA-Z0-9_-]{11}$/.test(sourceId)) {
      res.status(400).json({ error: 'Invalid YouTube video ID (must be 11 characters).' });
      return;
    }

    if (sourceType === 'upload' && !room.mediaItems[sourceId]) {
      res.status(404).json({ error: 'Uploaded media item not found in this room.' });
      return;
    }

    const nowIso = new Date().toISOString();
    let mediaItemId = sourceId;

    if (sourceType === 'youtube') {
      mediaItemId = `med_${crypto.randomBytes(6).toString('hex')}`;
      room.mediaItems[mediaItemId] = {
        id: mediaItemId,
        ownerId: actor.id,
        ownerName: actor.displayName,
        roomId: room.id,
        sourceType: 'youtube',
        title,
        sourceIdOrPath: sourceId,
        mimeType: 'video/youtube',
        fileSize: null,
        createdAt: nowIso,
      };
    }

    const mediaMeta = room.mediaItems[mediaItemId];
    const queueItem: QueueItemRecord = {
      id: `q_${crypto.randomBytes(6).toString('hex')}`,
      roomId: room.id,
      mediaItemId,
      sourceType,
      sourceId: sourceType === 'youtube' ? sourceId : mediaItemId,
      title: mediaMeta ? mediaMeta.title : title,
      mimeType: mediaMeta?.mimeType,
      fileSize: mediaMeta?.fileSize,
      position: room.queue.length,
      addedBy: actor.id,
      addedByName: actor.displayName,
      createdAt: nowIso,
    };

    room.queue.push(queueItem);

    // If room has no active media yet or host requested playImmediately, load it onto stage
    if ((playImmediately && room.hostId === actor.id) || room.activeMediaType === 'none') {
      room.activeMediaId = queueItem.mediaItemId;
      room.activeMediaType = queueItem.sourceType;
      room.activeMediaSource = queueItem.sourceId;
      room.activeMediaTitle = queueItem.title;
      room.playbackPosition = 0;
      room.isPlaying = true;
      room.playbackUpdatedAt = Date.now();

      broadcastToRoom(room.id, {
        type: 'playback:sync',
        activeMediaId: room.activeMediaId,
        activeMediaType: room.activeMediaType,
        activeMediaSource: room.activeMediaSource,
        activeMediaTitle: room.activeMediaTitle,
        playbackPosition: 0,
        isPlaying: true,
        updatedAt: room.playbackUpdatedAt,
        actorId: actor.id,
      });
    }

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'queue:updated',
      queue: room.queue,
      mediaItems: Object.values(room.mediaItems).map((m) => ({
        id: m.id,
        ownerId: m.ownerId,
        ownerName: m.ownerName,
        roomId: m.roomId,
        sourceType: m.sourceType,
        title: m.title,
        mimeType: m.mimeType,
        fileSize: m.fileSize,
        createdAt: m.createdAt,
      })),
    });

    res.status(201).json({ queue: room.queue, room: serializeRoomForClient(room) });
  });

  // Reorder or Play Next or Remove Queue Item
  app.patch('/api/rooms/:roomId/queue', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the room host can reorder or control the queue.' });
      return;
    }

    const action = req.body?.action;
    if (action === 'reorder' && Array.isArray(req.body?.orderedIds)) {
      const idOrder: string[] = req.body.orderedIds;
      const mapById = new Map(room.queue.map((item) => [item.id, item]));
      const reordered: QueueItemRecord[] = [];
      for (const id of idOrder) {
        const found = mapById.get(id);
        if (found) {
          reordered.push(found);
          mapById.delete(id);
        }
      }
      for (const leftover of mapById.values()) {
        reordered.push(leftover);
      }
      room.queue = reordered.map((item, idx) => ({ ...item, position: idx }));
    } else if (action === 'select' && typeof req.body?.queueId === 'string') {
      const target = room.queue.find((q) => q.id === req.body.queueId);
      if (!target) {
        res.status(404).json({ error: 'Queue item not found.' });
        return;
      }
      room.activeMediaId = target.mediaItemId;
      room.activeMediaType = target.sourceType;
      room.activeMediaSource = target.sourceId;
      room.activeMediaTitle = target.title;
      room.playbackPosition = 0;
      room.isPlaying = true;
      room.playbackUpdatedAt = Date.now();

      broadcastToRoom(room.id, {
        type: 'playback:sync',
        activeMediaId: room.activeMediaId,
        activeMediaType: room.activeMediaType,
        activeMediaSource: room.activeMediaSource,
        activeMediaTitle: room.activeMediaTitle,
        playbackPosition: 0,
        isPlaying: true,
        updatedAt: room.playbackUpdatedAt,
        actorId: actor.id,
      });
    } else if (action === 'play-next') {
      const currentIdx = room.queue.findIndex((q) => q.mediaItemId === room.activeMediaId);
      const nextItem =
        currentIdx >= 0 && currentIdx + 1 < room.queue.length
          ? room.queue[currentIdx + 1]
          : room.queue[0];

      if (nextItem) {
        room.activeMediaId = nextItem.mediaItemId;
        room.activeMediaType = nextItem.sourceType;
        room.activeMediaSource = nextItem.sourceId;
        room.activeMediaTitle = nextItem.title;
        room.playbackPosition = 0;
        room.isPlaying = true;
        room.playbackUpdatedAt = Date.now();

        broadcastToRoom(room.id, {
          type: 'playback:sync',
          activeMediaId: room.activeMediaId,
          activeMediaType: room.activeMediaType,
          activeMediaSource: room.activeMediaSource,
          activeMediaTitle: room.activeMediaTitle,
          playbackPosition: 0,
          isPlaying: true,
          updatedAt: room.playbackUpdatedAt,
          actorId: actor.id,
        });
      }
    }

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'queue:updated',
      queue: room.queue,
    });

    res.json({ queue: room.queue, room: serializeRoomForClient(room) });
  });

  app.delete('/api/rooms/:roomId/queue/:queueId', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the host can remove items from the queue.' });
      return;
    }

    room.queue = room.queue
      .filter((item) => item.id !== req.params.queueId)
      .map((item, idx) => ({ ...item, position: idx }));

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'queue:updated',
      queue: room.queue,
    });

    res.json({ queue: room.queue });
  });

  // 8. Private Video Upload with Validation & Signed URL Access
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() === '.webm' ? '.webm' : '.mp4';
      cb(null, `vid_${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  });

  const uploadMiddleware = multer({
    storage,
    limits: {
      fileSize: LIMITS.MAX_UPLOAD_FILE_SIZE_BYTES,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedMime = file.mimetype === 'video/mp4' || file.mimetype === 'video/webm';
      const allowedExt = ext === '.mp4' || ext === '.webm';
      if (!allowedMime || !allowedExt) {
        cb(new Error('Unsupported video format. Only MP4 (.mp4) and WebM (.webm) files are permitted.'));
        return;
      }
      cb(null, true);
    },
  }).single('video');

  app.post('/api/rooms/:roomId/upload', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);

    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }
    if (!room.members[actor.id]) {
      res.status(403).json({ error: 'Only authorized room members can upload videos.' });
      return;
    }

    // Rate limit uploads (max 4 uploads per 10 minutes per user)
    const now = Date.now();
    const userUploads = (uploadRateLimits.get(actor.id) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (userUploads.length >= 4) {
      res.status(429).json({
        error: 'Upload rate limit reached (max 4 video uploads per 10 minutes on the free tier).',
      });
      return;
    }

    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: `File exceeds the 50 MB free-tier upload limit. Please compress the video or use a shorter clip.`,
          });
          return;
        }
        res.status(400).json({ error: err.message || 'Video upload failed validation.' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No video file received.' });
        return;
      }

      // Inspect binary magic bytes to verify genuine MP4 or WebM container
      const isValidContainer = verifyVideoMagicBytes(file.path, file.mimetype);
      if (!isValidContainer) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // ignore
        }
        res.status(400).json({
          error: 'File header verification failed. The uploaded file is not a valid MP4 or WebM video container.',
        });
        return;
      }

      userUploads.push(Date.now());
      uploadRateLimits.set(actor.id, userUploads);

      const rawTitle = sanitizeText(req.body?.title || path.basename(file.originalname, path.extname(file.originalname)), 160);
      const title = rawTitle || 'Uploaded Video';
      const mediaId = `med_${crypto.randomBytes(8).toString('hex')}`;
      const nowIso = new Date().toISOString();

      const mediaItem: MediaItemRecord = {
        id: mediaId,
        ownerId: actor.id,
        ownerName: actor.displayName,
        roomId: room.id,
        sourceType: 'upload',
        title,
        sourceIdOrPath: file.path,
        mimeType: file.mimetype,
        fileSize: file.size,
        createdAt: nowIso,
      };

      room.mediaItems[mediaId] = mediaItem;

      // Automatically add to queue if actor is host or participant queue is allowed
      let addedQueueItem: QueueItemRecord | null = null;
      if (room.hostId === actor.id || room.allowParticipantQueue) {
        addedQueueItem = {
          id: `q_${crypto.randomBytes(6).toString('hex')}`,
          roomId: room.id,
          mediaItemId: mediaId,
          sourceType: 'upload',
          sourceId: mediaId,
          title,
          mimeType: file.mimetype,
          fileSize: file.size,
          position: room.queue.length,
          addedBy: actor.id,
          addedByName: actor.displayName,
          createdAt: nowIso,
        };
        room.queue.push(addedQueueItem);
      }

      // If host uploaded and no active media is playing, or playImmediately is set
      const playImmediately = req.body?.playImmediately === 'true' || room.activeMediaType === 'none';
      if (room.hostId === actor.id && playImmediately) {
        room.activeMediaId = mediaId;
        room.activeMediaType = 'upload';
        room.activeMediaSource = mediaId;
        room.activeMediaTitle = title;
        room.playbackPosition = 0;
        room.isPlaying = true;
        room.playbackUpdatedAt = Date.now();

        broadcastToRoom(room.id, {
          type: 'playback:sync',
          activeMediaId: room.activeMediaId,
          activeMediaType: room.activeMediaType,
          activeMediaSource: room.activeMediaSource,
          activeMediaTitle: room.activeMediaTitle,
          playbackPosition: 0,
          isPlaying: true,
          updatedAt: room.playbackUpdatedAt,
          actorId: actor.id,
        });
      }

      saveStateToDisk();
      broadcastToRoom(room.id, {
        type: 'queue:updated',
        queue: room.queue,
        mediaItems: Object.values(room.mediaItems).map((m) => ({
          id: m.id,
          ownerId: m.ownerId,
          ownerName: m.ownerName,
          roomId: m.roomId,
          sourceType: m.sourceType,
          title: m.title,
          mimeType: m.mimeType,
          fileSize: m.fileSize,
          createdAt: m.createdAt,
        })),
      });

      res.status(201).json({
        mediaItem: {
          id: mediaItem.id,
          ownerId: mediaItem.ownerId,
          ownerName: mediaItem.ownerName,
          roomId: mediaItem.roomId,
          sourceType: mediaItem.sourceType,
          title: mediaItem.title,
          mimeType: mediaItem.mimeType,
          fileSize: mediaItem.fileSize,
          createdAt: mediaItem.createdAt,
        },
        queueItem: addedQueueItem,
      });
    });
  });

  // 9. Issue Time-Limited Signed Playback URL for Authorized Room Members Only
  app.post(
    '/api/rooms/:roomId/media/:mediaId/signed-url',
    requireActor,
    (req: AuthenticatedRequest, res: Response) => {
      const actor = req.actor!;
      const room = rooms.get(req.params.roomId);
      if (!room || room.status === 'ended') {
        res.status(404).json({ error: 'Room not found.' });
        return;
      }
      if (!room.members[actor.id]) {
        res.status(403).json({
          error: 'Unauthorized: Only verified room members can obtain playback access to private uploads.',
        });
        return;
      }

      const media = room.mediaItems[req.params.mediaId];
      if (!media || media.sourceType !== 'upload') {
        res.status(404).json({ error: 'Protected video file not found.' });
        return;
      }

      const expiresAt = Date.now() + LIMITS.SIGNED_URL_TTL_MS;
      const sig = createSignedMediaToken(room.id, media.id, actor.id, expiresAt);
      const signedUrl = `/api/media-stream/${encodeURIComponent(room.id)}/${encodeURIComponent(
        media.id
      )}?memberId=${encodeURIComponent(actor.id)}&expires=${expiresAt}&sig=${sig}`;

      res.json({
        signedUrl,
        expiresAt,
        mimeType: media.mimeType,
        title: media.title,
      });
    }
  );

  // 10. Stream Private Uploaded Video via Signed Token + HTTP Range Support
  app.get('/api/media-stream/:roomId/:mediaId', (req: Request, res: Response) => {
    const { roomId, mediaId } = req.params;
    const memberId = typeof req.query.memberId === 'string' ? req.query.memberId : '';
    const expires = Number(req.query.expires || 0);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';

    if (!memberId || !expires || !sig) {
      res.status(401).json({ error: 'Missing signed playback credentials.' });
      return;
    }

    if (!verifySignedMediaToken(roomId, mediaId, memberId, expires, sig)) {
      res.status(403).json({ error: 'Invalid or expired signed playback URL.' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room || room.status === 'ended' || !room.members[memberId]) {
      res.status(403).json({ error: 'Room membership is no longer active.' });
      return;
    }

    const media = room.mediaItems[mediaId];
    if (!media || media.sourceType !== 'upload' || !fs.existsSync(media.sourceIdOrPath)) {
      res.status(404).json({ error: 'Video file not found on storage.' });
      return;
    }

    const stat = fs.statSync(media.sourceIdOrPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Cache-Control', 'private, no-store');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(media.sourceIdOrPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': media.mimeType || 'video/mp4',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': media.mimeType || 'video/mp4',
      });
      fs.createReadStream(media.sourceIdOrPath).pipe(res);
    }
  });

  // 11. Delete Private Uploaded Video (Uploader or Host Moderation)
  app.delete('/api/rooms/:roomId/media/:mediaId', requireActor, (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    const room = rooms.get(req.params.roomId);
    if (!room || room.status === 'ended') {
      res.status(404).json({ error: 'Active room not found.' });
      return;
    }

    const media = room.mediaItems[req.params.mediaId];
    if (!media) {
      res.status(404).json({ error: 'Media item not found.' });
      return;
    }

    if (media.ownerId !== actor.id && room.hostId !== actor.id) {
      res.status(403).json({ error: 'Only the uploader or room host can delete this uploaded video.' });
      return;
    }

    if (media.sourceType === 'upload' && media.sourceIdOrPath && fs.existsSync(media.sourceIdOrPath)) {
      try {
        fs.unlinkSync(media.sourceIdOrPath);
      } catch {
        // ignore
      }
    }

    delete room.mediaItems[media.id];
    room.queue = room.queue
      .filter((q) => q.mediaItemId !== media.id)
      .map((item, idx) => ({ ...item, position: idx }));

    if (room.activeMediaId === media.id) {
      room.activeMediaId = '';
      room.activeMediaType = 'none';
      room.activeMediaSource = '';
      room.activeMediaTitle = '';
      room.playbackPosition = 0;
      room.isPlaying = false;
      room.playbackUpdatedAt = Date.now();

      broadcastToRoom(room.id, {
        type: 'playback:sync',
        activeMediaId: '',
        activeMediaType: 'none',
        activeMediaSource: '',
        activeMediaTitle: '',
        playbackPosition: 0,
        isPlaying: false,
        updatedAt: room.playbackUpdatedAt,
        actorId: actor.id,
      });
    }

    saveStateToDisk();
    broadcastToRoom(room.id, {
      type: 'queue:updated',
      queue: room.queue,
      mediaItems: Object.values(room.mediaItems).map((m) => ({
        id: m.id,
        ownerId: m.ownerId,
        ownerName: m.ownerName,
        roomId: m.roomId,
        sourceType: m.sourceType,
        title: m.title,
        mimeType: m.mimeType,
        fileSize: m.fileSize,
        createdAt: m.createdAt,
      })),
    });

    res.json({ deletedId: media.id });
  });

  // ============================================================================
  // WebSocket Server for Real-Time Sync, Chat, Presence & WebRTC Signaling
  // ============================================================================
  interface SocketClient {
    ws: WebSocket;
    roomId: string;
    actor: ActorIdentity;
  }

  const roomClients = new Map<string, Set<SocketClient>>();

  function broadcastToRoom(roomId: string, payload: Record<string, unknown>, excludeWs?: WebSocket) {
    const clients = roomClients.get(roomId);
    if (!clients) return;
    const message = JSON.stringify(payload);
    for (const client of clients) {
      if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  function sendToMember(roomId: string, targetMemberId: string, payload: Record<string, unknown>) {
    const clients = roomClients.get(roomId);
    if (!clients) return;
    const message = JSON.stringify(payload);
    for (const client of clients) {
      if (client.actor.id === targetMemberId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  function disconnectMemberSockets(roomId: string, memberId: string) {
    const clients = roomClients.get(roomId);
    if (!clients) return;
    for (const client of clients) {
      if (client.actor.id === memberId) {
        try {
          client.ws.close(4003, 'Removed from room by host');
        } catch {
          // ignore
        }
        clients.delete(client);
      }
    }
  }

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, request) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token') || undefined;
    const roomId = url.searchParams.get('roomId') || '';

    const actor = verifySessionToken(token);
    const room = rooms.get(roomId);

    if (!actor || !room || room.status === 'ended' || !room.members[actor.id]) {
      ws.close(4001, 'Unauthorized room socket connection');
      return;
    }

    const clientRecord: SocketClient = { ws, roomId, actor };
    if (!roomClients.has(roomId)) {
      roomClients.set(roomId, new Set());
    }
    roomClients.get(roomId)!.add(clientRecord);

    // Mark member online & clear any pending host transfer timer
    const member = room.members[actor.id];
    member.isOnline = true;
    member.lastSeenAt = new Date().toISOString();
    room.expiresAt = Date.now() + LIMITS.IDLE_ROOM_EXPIRY_MS;

    // If original host reconnected, cancel pending host transfer
    if (hostDisconnectTimers.has(roomId) && room.hostId === actor.id) {
      clearTimeout(hostDisconnectTimers.get(roomId)!);
      hostDisconnectTimers.delete(roomId);
    }

    // Send initial authoritative room snapshot to connecting client
    ws.send(
      JSON.stringify({
        type: 'room:init',
        room: serializeRoomForClient(room),
      })
    );

    // Broadcast updated presence to room
    broadcastToRoom(
      roomId,
      {
        type: 'presence:sync',
        members: Object.values(room.members),
      },
      ws
    );

    ws.on('message', (rawData) => {
      let msg: any;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      const currentRoom = rooms.get(roomId);
      if (!currentRoom || currentRoom.status === 'ended') return;
      const currentMember = currentRoom.members[actor.id];
      if (!currentMember) return;

      currentMember.lastSeenAt = new Date().toISOString();
      currentRoom.expiresAt = Date.now() + LIMITS.IDLE_ROOM_EXPIRY_MS;

      switch (msg.type) {
        // 1. Authoritative Playback Sync (Host Only)
        case 'playback:update': {
          if (currentRoom.hostId !== actor.id) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Only the room host can control shared playback.',
              })
            );
            return;
          }

          if (typeof msg.activeMediaId === 'string') currentRoom.activeMediaId = sanitizeText(msg.activeMediaId, 128);
          if (msg.activeMediaType === 'youtube' || msg.activeMediaType === 'upload' || msg.activeMediaType === 'none') {
            currentRoom.activeMediaType = msg.activeMediaType;
          }
          if (typeof msg.activeMediaSource === 'string') {
            currentRoom.activeMediaSource = sanitizeText(msg.activeMediaSource, 500);
          }
          if (typeof msg.activeMediaTitle === 'string') {
            currentRoom.activeMediaTitle = sanitizeText(msg.activeMediaTitle, 200);
          }
          if (typeof msg.playbackPosition === 'number' && !isNaN(msg.playbackPosition) && msg.playbackPosition >= 0) {
            currentRoom.playbackPosition = Math.min(86400, Number(msg.playbackPosition.toFixed(2)));
          }
          if (typeof msg.isPlaying === 'boolean') {
            currentRoom.isPlaying = msg.isPlaying;
          }
          currentRoom.playbackUpdatedAt = Date.now();

          broadcastToRoom(
            roomId,
            {
              type: 'playback:sync',
              activeMediaId: currentRoom.activeMediaId,
              activeMediaType: currentRoom.activeMediaType,
              activeMediaSource: currentRoom.activeMediaSource,
              activeMediaTitle: currentRoom.activeMediaTitle,
              playbackPosition: currentRoom.playbackPosition,
              isPlaying: currentRoom.isPlaying,
              updatedAt: currentRoom.playbackUpdatedAt,
              actorId: actor.id,
            },
            ws
          );
          break;
        }

        // 2. Request Authoritative Sync State (On Join / Reconnect / Drift Check)
        case 'playback:request_sync': {
          ws.send(
            JSON.stringify({
              type: 'playback:sync',
              activeMediaId: currentRoom.activeMediaId,
              activeMediaType: currentRoom.activeMediaType,
              activeMediaSource: currentRoom.activeMediaSource,
              activeMediaTitle: currentRoom.activeMediaTitle,
              playbackPosition: computeCurrentPlaybackPosition(currentRoom),
              isPlaying: currentRoom.isPlaying,
              updatedAt: Date.now(),
              actorId: currentRoom.hostId,
            })
          );
          break;
        }

        // 3. Live Chat Message with Rate Limiting & Bounds
        case 'chat:send': {
          const text = sanitizeText(msg.message, LIMITS.MAX_CHAT_MESSAGE_LENGTH);
          if (!text) return;

          const now = Date.now();
          const recent = (chatRateLimits.get(actor.id) || []).filter((t) => now - t < 5000);
          if (recent.length >= 5) {
            ws.send(
              JSON.stringify({
                type: 'chat:rate_limited',
                message: 'You are sending messages too quickly. Please wait a moment.',
              })
            );
            return;
          }
          recent.push(now);
          chatRateLimits.set(actor.id, recent);

          const chatMsg: ChatMessageRecord = {
            id: sanitizeText(msg.clientId, 64) || `msg_${crypto.randomBytes(8).toString('hex')}`,
            roomId,
            senderId: actor.id,
            displayName: currentMember.displayName,
            avatarUrl: currentMember.avatarUrl,
            message: text,
            reactions: {},
            createdAt: new Date().toISOString(),
          };

          // Guard against duplicate message IDs (Idempotency)
          if (!currentRoom.messages.some((m) => m.id === chatMsg.id)) {
            currentRoom.messages.push(chatMsg);
            if (currentRoom.messages.length > 200) {
              currentRoom.messages = currentRoom.messages.slice(-200);
            }
            saveStateToDisk();
          }

          broadcastToRoom(roomId, {
            type: 'chat:message',
            message: chatMsg,
          });
          break;
        }

        // 4. Emoji Reaction on Chat Message
        case 'chat:reaction': {
          const messageId = sanitizeText(msg.messageId, 64);
          const emoji = sanitizeText(msg.emoji, 8);
          const allowedEmojis = ['👍', '❤️', '😂', '🔥', '👏', '😮'];
          if (!messageId || !allowedEmojis.includes(emoji)) return;

          const targetMsg = currentRoom.messages.find((m) => m.id === messageId);
          if (!targetMsg) return;

          const existingReactors = targetMsg.reactions[emoji] || [];
          if (existingReactors.includes(actor.id)) {
            targetMsg.reactions[emoji] = existingReactors.filter((id) => id !== actor.id);
            if (targetMsg.reactions[emoji].length === 0) {
              delete targetMsg.reactions[emoji];
            }
          } else {
            targetMsg.reactions[emoji] = [...existingReactors, actor.id];
          }

          broadcastToRoom(roomId, {
            type: 'chat:reaction_updated',
            messageId: targetMsg.id,
            reactions: targetMsg.reactions,
          });
          break;
        }

        // 5. Typing Indicator
        case 'chat:typing': {
          broadcastToRoom(
            roomId,
            {
              type: 'chat:typing',
              memberId: actor.id,
              displayName: currentMember.displayName,
              isTyping: Boolean(msg.isTyping),
            },
            ws
          );
          break;
        }

        // 6. WebRTC Group Voice Presence & Mesh Signaling
        case 'voice:join': {
          const activeVoiceCount = Object.values(currentRoom.members).filter(
            (m) => m.inVoice && m.memberId !== actor.id
          ).length;

          if (activeVoiceCount >= LIMITS.RECOMMENDED_VOICE_PARTICIPANTS) {
            ws.send(
              JSON.stringify({
                type: 'voice:limit_reached',
                message: `Voice channel is full (maximum ${LIMITS.RECOMMENDED_VOICE_PARTICIPANTS} active voice participants in peer-to-peer mesh mode).`,
              })
            );
            return;
          }

          currentMember.inVoice = true;
          currentMember.isMuted = Boolean(msg.isMuted);
          currentMember.isSpeaking = false;

          broadcastToRoom(roomId, {
            type: 'voice:state_sync',
            members: Object.values(currentRoom.members),
            joinedMemberId: actor.id,
          });
          break;
        }

        case 'voice:leave': {
          currentMember.inVoice = false;
          currentMember.isMuted = false;
          currentMember.isSpeaking = false;

          broadcastToRoom(roomId, {
            type: 'voice:state_sync',
            members: Object.values(currentRoom.members),
            leftMemberId: actor.id,
          });
          break;
        }

        case 'voice:status': {
          if (!currentMember.inVoice) return;
          if (typeof msg.isMuted === 'boolean') currentMember.isMuted = msg.isMuted;
          if (typeof msg.isSpeaking === 'boolean') currentMember.isSpeaking = msg.isSpeaking;

          broadcastToRoom(
            roomId,
            {
              type: 'voice:member_status',
              memberId: actor.id,
              isMuted: currentMember.isMuted,
              isSpeaking: currentMember.isSpeaking,
            },
            ws
          );
          break;
        }

        // Room-Scoped Peer-to-Peer WebRTC Signaling (Offer / Answer / ICE Candidate)
        case 'webrtc:signal': {
          const targetMemberId = sanitizeText(msg.targetMemberId, 128);
          if (!targetMemberId || targetMemberId === actor.id) return;
          const targetMember = currentRoom.members[targetMemberId];
          // Strictly ensure both sender and recipient belong to the same room and are in voice
          if (!targetMember || !currentMember.inVoice || !targetMember.inVoice) return;

          sendToMember(roomId, targetMemberId, {
            type: 'webrtc:signal',
            fromMemberId: actor.id,
            fromDisplayName: currentMember.displayName,
            signalType: msg.signalType, // 'offer' | 'answer' | 'ice-candidate'
            sdp: msg.sdp,
            candidate: msg.candidate,
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      const clients = roomClients.get(roomId);
      if (clients) {
        clients.delete(clientRecord);
      }

      // Check if actor still has another active tab connected to this room
      const stillConnected = clients
        ? Array.from(clients).some((c) => c.actor.id === actor.id && c.ws.readyState === WebSocket.OPEN)
        : false;

      const currentRoom = rooms.get(roomId);
      if (!currentRoom || stillConnected) return;

      const m = currentRoom.members[actor.id];
      if (m) {
        m.isOnline = false;
        m.inVoice = false;
        m.isSpeaking = false;
        m.lastSeenAt = new Date().toISOString();
      }

      broadcastToRoom(roomId, {
        type: 'presence:sync',
        members: Object.values(currentRoom.members),
        leftVoiceMemberId: actor.id,
      });

      // Controlled Host Reconnection / Fallback Transfer after 25s if host disconnects
      if (currentRoom.hostId === actor.id && currentRoom.status === 'active') {
        const existingTimer = hostDisconnectTimers.get(roomId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
          const checkRoom = rooms.get(roomId);
          if (!checkRoom || checkRoom.status !== 'active') return;
          const hostMember = checkRoom.members[checkRoom.hostId];
          if (hostMember && hostMember.isOnline) return;

          // Find next online participant to assume host controls
          const onlineNext = Object.values(checkRoom.members).find(
            (cand) => cand.isOnline && cand.memberId !== checkRoom.hostId
          );
          if (onlineNext) {
            if (hostMember) {
              hostMember.role = hostMember.authType === 'guest' ? 'guest' : 'participant';
            }
            onlineNext.role = 'host';
            checkRoom.hostId = onlineNext.memberId;

            const transferMsg: ChatMessageRecord = {
              id: `msg_${crypto.randomBytes(6).toString('hex')}`,
              roomId: checkRoom.id,
              senderId: 'system',
              displayName: 'FriendsFlix',
              avatarUrl: '',
              message: `Host disconnected. ${onlineNext.displayName} is now the room host.`,
              reactions: {},
              createdAt: new Date().toISOString(),
              isSystem: true,
            };
            checkRoom.messages.push(transferMsg);
            saveStateToDisk();

            broadcastToRoom(checkRoom.id, {
              type: 'room:host_transferred',
              hostId: checkRoom.hostId,
              members: Object.values(checkRoom.members),
              systemMessage: transferMsg,
            });
          }
        }, 25000);

        hostDisconnectTimers.set(roomId, timer);
      }
    });
  });

  // Vite Middleware in Development / Static Dist in Production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`FriendsFlix server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
