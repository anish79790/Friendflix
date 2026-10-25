import type {
  ClientRoomState,
  ClientMember,
  ClientChatMessage,
  ClientQueueItem,
  ClientMediaItem,
} from '../components/WatchRoomPage';
import { parseYouTubeVideoId } from './youtube';

export interface JoinRequestItem {
  memberId: string;
  displayName: string;
  avatarUrl: string;
  authType: 'firebase' | 'guest';
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  updatedAt: string;
}

export interface ActorSession {
  id: string;
  displayName: string;
  avatarUrl: string;
  authType: 'firebase' | 'guest';
}

const LOCAL_ROOMS_STORAGE_KEY = 'friendsflix_rooms_store_v2';
const BROADCAST_CHANNEL_NAME = 'friendsflix_realtime_bus_v2';

// Cryptographically random unique room code generator (e.g. FFX-7K9M-4P2X)
// Uses 32 unambiguous uppercase alphanumeric characters -> > 1,000,000,000,000 combinations
export function generateUniqueInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = new Uint8Array(8);
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 8; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += chars[randomBytes[i] % chars.length];
  }
  for (let i = 4; i < 8; i++) {
    part2 += chars[randomBytes[i] % chars.length];
  }
  return `FFX-${part1}-${part2}`;
}

// Detect if user accidentally pasted a YouTube URL into the Room Invite Code input
export function isYouTubeLink(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return (
    trimmed.includes('youtube.com/') ||
    trimmed.includes('youtu.be/') ||
    trimmed.includes('youtube-nocookie.com/')
  );
}

// Cleanly extract roomId and inviteCode from either a raw code (e.g. FFX-7K9M-4P2X) or full invite URL
export function extractRoomLookup(rawInput: string): {
  roomId: string;
  inviteCode: string;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) return { roomId: '', inviteCode: '' };

  if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('?')) {
    try {
      const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://localhost/${trimmed}`);
      const roomParam = (urlObj.searchParams.get('room') || '').trim();
      const codeParam = (urlObj.searchParams.get('code') || '').trim().toUpperCase();
      return {
        roomId: roomParam,
        inviteCode: codeParam,
      };
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('rm_')) {
    return { roomId: trimmed, inviteCode: '' };
  }

  return {
    roomId: '',
    inviteCode: trimmed.toUpperCase(),
  };
}

// Safe JSON fetch helper that NEVER throws `Unexpected token 'T', "The page c"... is not valid JSON`
export async function safeJsonFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; isServerUnavailable: boolean; error?: string }> {
  try {
    const resp = await fetch(url, options);
    const contentType = resp.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      // E.g. Vercel static hosting returning 404 HTML/text "The page could not be found"
      return {
        ok: false,
        status: resp.status,
        data: null,
        isServerUnavailable: true,
        error: 'Backend API endpoint is unavailable on this static host.',
      };
    }

    const data = await resp.json();
    return {
      ok: resp.ok,
      status: resp.status,
      data,
      isServerUnavailable: false,
      error: !resp.ok ? data?.error || `Request failed (${resp.status})` : undefined,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      isServerUnavailable: true,
      error: 'Network or backend server unreachable.',
    };
  }
}

// ============================================================================
// Client-Side / Static-Host (Vercel) Fallback Store + BroadcastChannel Bus
// ============================================================================
function loadLocalRooms(): Record<string, ClientRoomState> {
  try {
    const raw = localStorage.getItem(LOCAL_ROOMS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveLocalRooms(roomsMap: Record<string, ClientRoomState>) {
  try {
    localStorage.setItem(LOCAL_ROOMS_STORAGE_KEY, JSON.stringify(roomsMap));
  } catch {
    // ignore quota errors
  }
}

export function broadcastLocalRoomEvent(payload: Record<string, any>) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {
    // ignore
  }
}

export function subscribeLocalRoomEvents(onEvent: (data: any) => void): () => void {
  let bc: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.onmessage = (ev) => {
        if (ev.data) onEvent(ev.data);
      };
    }
  } catch {
    // ignore
  }

  const onStorage = (ev: StorageEvent) => {
    if (ev.key === LOCAL_ROOMS_STORAGE_KEY && ev.newValue) {
      try {
        const roomsMap = JSON.parse(ev.newValue);
        onEvent({ type: 'local:rooms_updated', roomsMap });
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    if (bc) bc.close();
    window.removeEventListener('storage', onStorage);
  };
}

export function createFallbackSession(params: {
  displayName: string;
  externalUid?: string;
  authType?: 'firebase' | 'guest';
  avatarUrl?: string;
  existingActorId?: string;
}): { actor: ActorSession; token: string } {
  const cleanName = params.displayName.trim().slice(0, 40) || 'Guest';
  const authType = params.authType === 'firebase' ? 'firebase' : 'guest';
  let actorId = params.existingActorId || '';

  if (authType === 'firebase' && params.externalUid) {
    actorId = `firebase_${params.externalUid}`;
  } else if (!actorId || !actorId.startsWith('guest_')) {
    const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    actorId = `guest_${rand}`;
  }

  const actor: ActorSession = {
    id: actorId,
    displayName: cleanName,
    avatarUrl: params.avatarUrl || '',
    authType,
  };

  const token = `local_${btoa(encodeURIComponent(JSON.stringify(actor)))}.fallback`;
  return { actor, token };
}

export function createFallbackRoom(params: {
  actor: ActorSession;
  name: string;
  isPrivate: boolean;
  customInviteCode?: string;
  initialYoutubeId?: string;
  initialYoutubeTitle?: string;
}): ClientRoomState {
  const roomsMap = loadLocalRooms();
  const existingCodes = new Set(Object.values(roomsMap).map((r) => r.inviteCode.toUpperCase()));

  let inviteCode = (params.customInviteCode || '').trim().toUpperCase();
  if (!inviteCode || !/^[A-Z0-9\-]{6,16}$/.test(inviteCode) || existingCodes.has(inviteCode)) {
    inviteCode = generateUniqueInviteCode();
    while (existingCodes.has(inviteCode)) {
      inviteCode = generateUniqueInviteCode();
    }
  }

  const roomId = `rm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const ytId =
    params.initialYoutubeId && /^[a-zA-Z0-9_-]{11}$/.test(params.initialYoutubeId)
      ? params.initialYoutubeId
      : parseYouTubeVideoId(params.initialYoutubeId || '') || '';
  const ytTitle = ytId ? params.initialYoutubeTitle || 'Featured Watch Party Video' : '';
  const mediaId = ytId ? `med_${Math.random().toString(36).slice(2, 10)}` : '';

  const mediaItems: ClientMediaItem[] = ytId
    ? [
        {
          id: mediaId,
          ownerId: params.actor.id,
          ownerName: params.actor.displayName,
          roomId,
          sourceType: 'youtube',
          title: ytTitle,
          mimeType: 'video/youtube',
          fileSize: null,
          createdAt: nowIso,
        },
      ]
    : [];

  const queue: ClientQueueItem[] = ytId
    ? [
        {
          id: `q_${Math.random().toString(36).slice(2, 10)}`,
          roomId,
          mediaItemId: mediaId,
          sourceType: 'youtube',
          sourceId: ytId,
          title: ytTitle,
          position: 0,
          addedBy: params.actor.id,
          addedByName: params.actor.displayName,
          createdAt: nowIso,
        },
      ]
    : [];

  const room: ClientRoomState = {
    id: roomId,
    name: params.name.trim().slice(0, 80) || 'Watch Room',
    hostId: params.actor.id,
    inviteCode,
    isPrivate: params.isPrivate,
    isLocked: false,
    allowParticipantQueue: false,
    status: 'active',
    activeMediaId: mediaId,
    activeMediaType: ytId ? 'youtube' : 'none',
    activeMediaSource: ytId,
    activeMediaTitle: ytTitle,
    playbackPosition: 0,
    isPlaying: false,
    playbackUpdatedAt: nowMs,
    createdAt: nowIso,
    expiresAt: nowMs + 120 * 60 * 1000,
    members: [
      {
        memberId: params.actor.id,
        displayName: params.actor.displayName,
        avatarUrl: params.actor.avatarUrl,
        authType: params.actor.authType,
        role: 'host',
        joinedAt: nowIso,
        lastSeenAt: nowIso,
        isOnline: true,
        inVoice: false,
        isMuted: false,
        isSpeaking: false,
      },
    ],
    joinRequests: [],
    mediaItems,
    queue,
    messages: [
      {
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        roomId,
        senderId: 'system',
        displayName: 'FriendsFlix',
        avatarUrl: '',
        message: `${params.actor.displayName} created "${params.name}". Unique Room Code: ${inviteCode} (${
          params.isPrivate ? 'Private — Request to Join' : 'Public — Direct Join'
        }).`,
        reactions: {},
        createdAt: nowIso,
        isSystem: true,
      },
    ],
  };

  roomsMap[roomId] = room;
  saveLocalRooms(roomsMap);
  return room;
}

export function joinFallbackRoom(params: {
  actor: ActorSession;
  roomCodeOrLink: string;
}):
  | { status: 'joined'; room: ClientRoomState }
  | {
      status: 'pending_approval';
      roomId: string;
      roomName: string;
      inviteCode: string;
      message: string;
    } {
  const { roomId, inviteCode } = extractRoomLookup(params.roomCodeOrLink);
  const roomsMap = loadLocalRooms();

  let targetRoom: ClientRoomState | undefined;
  if (inviteCode) {
    targetRoom = Object.values(roomsMap).find(
      (r) => r.inviteCode.toUpperCase() === inviteCode.toUpperCase()
    );
  }
  if (!targetRoom && roomId) {
    targetRoom = roomsMap[roomId];
  }

  if (!targetRoom || targetRoom.status === 'ended') {
    throw new Error('Room not found with that code. Check the unique Room Code and try again.');
  }

  if (targetRoom.isLocked && targetRoom.hostId !== params.actor.id) {
    const alreadyMember = targetRoom.members.some((m) => m.memberId === params.actor.id);
    if (!alreadyMember) {
      throw new Error('This room is currently locked by the host.');
    }
  }

  const existingMember = targetRoom.members.find((m) => m.memberId === params.actor.id);
  const nowIso = new Date().toISOString();

  if (existingMember || targetRoom.hostId === params.actor.id) {
    if (existingMember) {
      existingMember.displayName = params.actor.displayName;
      existingMember.isOnline = true;
      existingMember.lastSeenAt = nowIso;
    }
    saveLocalRooms(roomsMap);
    broadcastLocalRoomEvent({ type: 'room:updated', roomId: targetRoom.id, room: targetRoom });
    return { status: 'joined', room: targetRoom };
  }

  // Check if Private Room requires Host Approval
  if (targetRoom.isPrivate) {
    const requests = targetRoom.joinRequests || [];
    const existingReq = requests.find((r) => r.memberId === params.actor.id);

    if (existingReq && existingReq.status === 'approved') {
      // Approved! Add to members
      targetRoom.members.push({
        memberId: params.actor.id,
        displayName: params.actor.displayName,
        avatarUrl: params.actor.avatarUrl,
        authType: params.actor.authType,
        role: params.actor.authType === 'guest' ? 'guest' : 'participant',
        joinedAt: nowIso,
        lastSeenAt: nowIso,
        isOnline: true,
        inVoice: false,
        isMuted: false,
        isSpeaking: false,
      });
      targetRoom.joinRequests = requests.filter((r) => r.memberId !== params.actor.id);
      saveLocalRooms(roomsMap);
      broadcastLocalRoomEvent({ type: 'room:updated', roomId: targetRoom.id, room: targetRoom });
      return { status: 'joined', room: targetRoom };
    }

    // Create or refresh pending join request
    const newReq: JoinRequestItem = {
      memberId: params.actor.id,
      displayName: params.actor.displayName,
      avatarUrl: params.actor.avatarUrl,
      authType: params.actor.authType,
      status: 'pending',
      requestedAt: existingReq?.requestedAt || nowIso,
      updatedAt: nowIso,
    };

    targetRoom.joinRequests = [
      ...requests.filter((r) => r.memberId !== params.actor.id),
      newReq,
    ];
    saveLocalRooms(roomsMap);
    broadcastLocalRoomEvent({
      type: 'room:join_request',
      roomId: targetRoom.id,
      joinRequests: targetRoom.joinRequests,
      room: targetRoom,
    });

    return {
      status: 'pending_approval',
      roomId: targetRoom.id,
      roomName: targetRoom.name,
      inviteCode: targetRoom.inviteCode,
      message: 'Join request sent to the room host. Waiting for host approval...',
    };
  }

  // Public Room: Join directly without request!
  if (targetRoom.members.length >= 8) {
    throw new Error('This room is full (maximum 8 participants).');
  }

  targetRoom.members.push({
    memberId: params.actor.id,
    displayName: params.actor.displayName,
    avatarUrl: params.actor.avatarUrl,
    authType: params.actor.authType,
    role: params.actor.authType === 'guest' ? 'guest' : 'participant',
    joinedAt: nowIso,
    lastSeenAt: nowIso,
    isOnline: true,
    inVoice: false,
    isMuted: false,
    isSpeaking: false,
  });

  targetRoom.messages.push({
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    roomId: targetRoom.id,
    senderId: 'system',
    displayName: 'FriendsFlix',
    avatarUrl: '',
    message: `${params.actor.displayName} joined the public room directly.`,
    reactions: {},
    createdAt: nowIso,
    isSystem: true,
  });

  saveLocalRooms(roomsMap);
  broadcastLocalRoomEvent({ type: 'room:updated', roomId: targetRoom.id, room: targetRoom });
  return { status: 'joined', room: targetRoom };
}

export function checkFallbackJoinStatus(params: {
  roomId: string;
  actorId: string;
}): { status: 'approved' | 'rejected' | 'pending'; room?: ClientRoomState; error?: string } {
  const roomsMap = loadLocalRooms();
  const room = roomsMap[params.roomId];
  if (!room || room.status === 'ended') {
    return { status: 'rejected', error: 'Room was ended or no longer exists.' };
  }

  if (room.members.some((m) => m.memberId === params.actorId)) {
    return { status: 'approved', room };
  }

  const req = (room.joinRequests || []).find((r) => r.memberId === params.actorId);
  if (!req) {
    return { status: 'pending' };
  }
  if (req.status === 'approved') {
    return { status: 'approved', room };
  }
  if (req.status === 'rejected') {
    return { status: 'rejected', error: 'The room host declined your join request.' };
  }
  return { status: 'pending' };
}

export function respondFallbackJoinRequest(params: {
  roomId: string;
  hostId: string;
  targetMemberId: string;
  action: 'approve' | 'reject';
}): ClientRoomState | null {
  const roomsMap = loadLocalRooms();
  const room = roomsMap[params.roomId];
  if (!room || room.hostId !== params.hostId) return null;

  const requests = room.joinRequests || [];
  const targetReq = requests.find((r) => r.memberId === params.targetMemberId);
  if (!targetReq) return room;

  const nowIso = new Date().toISOString();

  if (params.action === 'approve') {
    targetReq.status = 'approved';
    targetReq.updatedAt = nowIso;

    if (!room.members.some((m) => m.memberId === targetReq.memberId)) {
      room.members.push({
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
      });

      room.messages.push({
        id: `msg_${Math.random().toString(36).slice(2, 10)}`,
        roomId: room.id,
        senderId: 'system',
        displayName: 'FriendsFlix',
        avatarUrl: '',
        message: `${targetReq.displayName}'s join request was approved by the host.`,
        reactions: {},
        createdAt: nowIso,
        isSystem: true,
      });
    }
    room.joinRequests = requests.filter((r) => r.memberId !== params.targetMemberId);
  } else {
    targetReq.status = 'rejected';
    targetReq.updatedAt = nowIso;
    room.joinRequests = requests.filter((r) => r.memberId !== params.targetMemberId);
  }

  saveLocalRooms(roomsMap);
  broadcastLocalRoomEvent({
    type: 'room:join_request_responded',
    roomId: room.id,
    targetMemberId: params.targetMemberId,
    action: params.action,
    room,
  });
  return room;
}

export function updateFallbackRoom(
  roomId: string,
  updater: (room: ClientRoomState) => ClientRoomState
): ClientRoomState | null {
  const roomsMap = loadLocalRooms();
  const existing = roomsMap[roomId];
  if (!existing) return null;
  const updated = updater(existing);
  roomsMap[roomId] = updated;
  saveLocalRooms(roomsMap);
  broadcastLocalRoomEvent({ type: 'room:updated', roomId, room: updated });
  return updated;
}

export function getFallbackRoom(roomId: string): ClientRoomState | null {
  const roomsMap = loadLocalRooms();
  return roomsMap[roomId] || null;
}
