import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot as required by firebase-integration-rpc
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Defensive Validation Constants synced verbatim with firebase-blueprint.json
export const BLUEPRINT_CONSTRAINTS = {
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  INVITE_CODE_REGEX: /^[A-Z0-9\-]+$/,
  DISPLAY_NAME_MAX: 40,
  ROOM_NAME_MAX: 80,
  AVATAR_URL_MAX: 500,
  MEDIA_TITLE_MAX: 200,
  MEDIA_SOURCE_MAX: 500,
  CHAT_MESSAGE_MAX: 500,
};

function sanitizeString(val: string, maxLen: number, fallback = ''): string {
  const trimmed = (val || '').trim().slice(0, maxLen);
  return trimmed || fallback;
}

export async function signInWithGooglePopup(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  await syncUserProfileToFirestore(user);
  return user;
}

export async function signOutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

export { onAuthStateChanged };
export type { User };

export async function syncUserProfileToFirestore(user: User): Promise<void> {
  if (!user || !user.emailVerified) return;
  const uid = user.uid;
  if (!BLUEPRINT_CONSTRAINTS.ID_REGEX.test(uid)) return;

  const path = `users/${uid}`;
  const displayName = sanitizeString(
    user.displayName || user.email?.split('@')[0] || 'Member',
    BLUEPRINT_CONSTRAINTS.DISPLAY_NAME_MAX,
    'Member'
  );
  const avatarUrl = sanitizeString(user.photoURL || '', BLUEPRINT_CONSTRAINTS.AVATAR_URL_MAX, '');

  try {
    const existingSnap = await getDocFromServer(doc(db, 'users', uid));
    if (!existingSnap.exists()) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        displayName,
        avatarUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'users', uid), {
        displayName,
        avatarUrl,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function mirrorRoomCreationToFirestore(room: {
  id: string;
  name: string;
  inviteCode: string;
  isPrivate: boolean;
  isLocked: boolean;
  activeMediaId: string;
  activeMediaType: 'youtube' | 'upload' | 'none';
  activeMediaSource: string;
  activeMediaTitle: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  if (!BLUEPRINT_CONSTRAINTS.ID_REGEX.test(room.id)) return;

  const roomPath = `rooms/${room.id}`;
  try {
    const batch = writeBatch(db);
    const roomRef = doc(db, 'rooms', room.id);
    const memberRef = doc(db, 'rooms', room.id, 'members', user.uid);

    batch.set(roomRef, {
      id: room.id.slice(0, 64),
      name: sanitizeString(room.name, BLUEPRINT_CONSTRAINTS.ROOM_NAME_MAX, 'Watch Party'),
      hostId: user.uid,
      inviteCode: sanitizeString(room.inviteCode.toUpperCase(), 16, 'FFX00000'),
      isPrivate: Boolean(room.isPrivate),
      isLocked: Boolean(room.isLocked),
      status: 'active',
      activeMediaId: (room.activeMediaId || '').slice(0, 128),
      activeMediaType: room.activeMediaType || 'none',
      activeMediaSource: (room.activeMediaSource || '').slice(0, BLUEPRINT_CONSTRAINTS.MEDIA_SOURCE_MAX),
      activeMediaTitle: (room.activeMediaTitle || '').slice(0, BLUEPRINT_CONSTRAINTS.MEDIA_TITLE_MAX),
      playbackPosition: 0,
      isPlaying: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(memberRef, {
      roomId: room.id.slice(0, 64),
      userId: user.uid,
      displayName: sanitizeString(
        user.displayName || 'Host',
        BLUEPRINT_CONSTRAINTS.DISPLAY_NAME_MAX,
        'Host'
      ),
      role: 'host',
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, roomPath);
  }
}

export async function mirrorRoomPlaybackToFirestore(params: {
  roomId: string;
  activeMediaId: string;
  activeMediaType: 'youtube' | 'upload' | 'none';
  activeMediaSource: string;
  activeMediaTitle: string;
  playbackPosition: number;
  isPlaying: boolean;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  if (!BLUEPRINT_CONSTRAINTS.ID_REGEX.test(params.roomId)) return;

  const roomPath = `rooms/${params.roomId}`;
  try {
    const roomSnap = await getDocFromServer(doc(db, 'rooms', params.roomId));
    if (!roomSnap.exists() || roomSnap.data()?.hostId !== user.uid) return;

    await updateDoc(doc(db, 'rooms', params.roomId), {
      activeMediaId: (params.activeMediaId || '').slice(0, 128),
      activeMediaType: params.activeMediaType || 'none',
      activeMediaSource: (params.activeMediaSource || '').slice(0, BLUEPRINT_CONSTRAINTS.MEDIA_SOURCE_MAX),
      activeMediaTitle: (params.activeMediaTitle || '').slice(0, BLUEPRINT_CONSTRAINTS.MEDIA_TITLE_MAX),
      playbackPosition: Math.max(0, Math.min(86400, Number(params.playbackPosition.toFixed(2)))),
      isPlaying: Boolean(params.isPlaying),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, roomPath);
  }
}

export async function mirrorChatMessageToFirestore(params: {
  id: string;
  roomId: string;
  displayName: string;
  message: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  if (
    !BLUEPRINT_CONSTRAINTS.ID_REGEX.test(params.id) ||
    !BLUEPRINT_CONSTRAINTS.ID_REGEX.test(params.roomId)
  ) {
    return;
  }

  const msgPath = `rooms/${params.roomId}/messages/${params.id}`;
  try {
    const memberSnap = await getDocFromServer(doc(db, 'rooms', params.roomId, 'members', user.uid));
    if (!memberSnap.exists()) return;

    await setDoc(doc(db, 'rooms', params.roomId, 'messages', params.id), {
      id: params.id.slice(0, 128),
      roomId: params.roomId.slice(0, 64),
      senderId: user.uid,
      displayName: sanitizeString(
        params.displayName,
        BLUEPRINT_CONSTRAINTS.DISPLAY_NAME_MAX,
        'Member'
      ),
      message: sanitizeString(params.message, BLUEPRINT_CONSTRAINTS.CHAT_MESSAGE_MAX, '...'),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, msgPath);
  }
}
