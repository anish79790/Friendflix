/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { WatchRoomPage, ClientRoomState } from './components/WatchRoomPage';
import { CreateRoomModal, JoinRoomModal, InfoModal, JoinRoomResult } from './components/Modals';
import {
  auth,
  onAuthStateChanged,
  signInWithGooglePopup,
  signOutFirebase,
  mirrorRoomCreationToFirestore,
} from './lib/firebase';
import {
  ActorSession,
  safeJsonFetch,
  createFallbackSession,
  createFallbackRoom,
  joinFallbackRoom,
  checkFallbackJoinStatus,
  getFallbackRoom,
} from './lib/roomEngine';
import { AlertCircle, X } from 'lucide-react';

const SESSION_TOKEN_KEY = 'friendsflix_session_token_v1';
const SESSION_ACTOR_KEY = 'friendsflix_actor_v1';
const ACTIVE_ROOM_ID_KEY = 'friendsflix_active_room_id_v1';

export default function App() {
  const [actor, setActor] = useState<ActorSession | null>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_ACTOR_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [sessionToken, setSessionToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SESSION_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });

  const [activeRoom, setActiveRoom] = useState<ClientRoomState | null>(null);
  const [createdPendingRoom, setCreatedPendingRoom] = useState<ClientRoomState | null>(null);

  // Dialog states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [initialJoinCode, setInitialJoinCode] = useState('');
  const [infoSection, setInfoSection] = useState<'architecture' | 'privacy' | 'terms' | 'contact' | null>(null);
  const [globalNotice, setGlobalNotice] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<any>(null);

  // Helper to obtain or refresh a signed server session token (with safe fallback on static hosts like Vercel)
  const ensureServerSession = useCallback(
    async (params: {
      displayName: string;
      externalUid?: string;
      authType?: 'firebase' | 'guest';
      avatarUrl?: string;
    }): Promise<{ actor: ActorSession; token: string }> => {
      const res = await safeJsonFetch<{ actor: ActorSession; token: string }>('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: params.displayName,
          existingToken: sessionToken || undefined,
          externalUid: params.externalUid,
          authType: params.authType || actor?.authType || 'guest',
          avatarUrl: params.avatarUrl ?? actor?.avatarUrl ?? '',
        }),
      });

      if (res.isServerUnavailable) {
        const fallback = createFallbackSession({
          displayName: params.displayName,
          externalUid: params.externalUid,
          authType: params.authType || actor?.authType || 'guest',
          avatarUrl: params.avatarUrl ?? actor?.avatarUrl ?? '',
          existingActorId: actor?.id,
        });
        setActor(fallback.actor);
        setSessionToken(fallback.token);
        try {
          sessionStorage.setItem(SESSION_ACTOR_KEY, JSON.stringify(fallback.actor));
          sessionStorage.setItem(SESSION_TOKEN_KEY, fallback.token);
        } catch {
          // ignore
        }
        return fallback;
      }

      if (!res.ok || !res.data) {
        throw new Error(res.error || 'Could not initialize session.');
      }

      setActor(res.data.actor);
      setSessionToken(res.data.token);
      try {
        sessionStorage.setItem(SESSION_ACTOR_KEY, JSON.stringify(res.data.actor));
        sessionStorage.setItem(SESSION_TOKEN_KEY, res.data.token);
      } catch {
        // ignore storage errors
      }
      return { actor: res.data.actor, token: res.data.token };
    },
    [sessionToken, actor]
  );

  // 1. Load backend configuration status safely
  useEffect(() => {
    safeJsonFetch('/api/config-status')
      .then((res) => {
        if (res.ok && res.data) {
          setConfigStatus(res.data);
        }
      })
      .catch(() => {});
  }, []);

  // 2. Listen for Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const name = fbUser.displayName || fbUser.email?.split('@')[0] || 'Member';
        try {
          await ensureServerSession({
            displayName: name,
            externalUid: fbUser.uid,
            authType: 'firebase',
            avatarUrl: fbUser.photoURL || '',
          });
        } catch {
          // ignore
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 3. Check URL for invitation link (?room=...&code=...) or recover active room after refresh
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const codeParam = params.get('code');

    if (codeParam || roomParam) {
      const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (savedToken && roomParam) {
        safeJsonFetch<{ room: ClientRoomState }>(`/api/rooms/${encodeURIComponent(roomParam)}`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        })
          .then((res) => {
            if (res.ok && res.data?.room) {
              setActiveRoom(res.data.room);
              return;
            }
            if (res.isServerUnavailable) {
              const localRoom = getFallbackRoom(roomParam);
              if (localRoom && actor && localRoom.members.some((m) => m.memberId === actor.id)) {
                setActiveRoom(localRoom);
                return;
              }
            }
            setInitialJoinCode((codeParam || roomParam || '').toUpperCase());
            setJoinModalOpen(true);
          })
          .catch(() => {
            setInitialJoinCode((codeParam || roomParam || '').toUpperCase());
            setJoinModalOpen(true);
          });
      } else {
        setInitialJoinCode((codeParam || roomParam || '').toUpperCase());
        setJoinModalOpen(true);
      }
      return;
    }

    // Otherwise check if user refreshed while inside an active room
    const savedRoomId = sessionStorage.getItem(ACTIVE_ROOM_ID_KEY);
    const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (savedRoomId && savedToken) {
      safeJsonFetch<{ room: ClientRoomState }>(`/api/rooms/${encodeURIComponent(savedRoomId)}`, {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then((res) => {
          if (res.ok && res.data?.room) {
            setActiveRoom(res.data.room);
          } else if (res.isServerUnavailable) {
            const localRoom = getFallbackRoom(savedRoomId);
            if (localRoom) {
              setActiveRoom(localRoom);
            } else {
              sessionStorage.removeItem(ACTIVE_ROOM_ID_KEY);
            }
          } else {
            sessionStorage.removeItem(ACTIVE_ROOM_ID_KEY);
          }
        })
        .catch(() => {
          sessionStorage.removeItem(ACTIVE_ROOM_ID_KEY);
        });
    }
  }, []);

  // Google Sign-In Handler
  const handleGoogleSignIn = async () => {
    try {
      const fbUser = await signInWithGooglePopup();
      const name = fbUser.displayName || fbUser.email?.split('@')[0] || 'Member';
      await ensureServerSession({
        displayName: name,
        externalUid: fbUser.uid,
        authType: 'firebase',
        avatarUrl: fbUser.photoURL || '',
      });
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setGlobalNotice(err?.message || 'Google Sign-In could not complete.');
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutFirebase();
    } catch {
      // ignore
    }
    setActor(null);
    setSessionToken('');
    sessionStorage.removeItem(SESSION_ACTOR_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(ACTIVE_ROOM_ID_KEY);
  };

  // Create Room Flow
  const handleCreateRoom = async (params: {
    roomName: string;
    displayName: string;
    isPrivate: boolean;
    customInviteCode: string;
    initialYoutubeId: string;
    initialYoutubeTitle: string;
  }) => {
    const session = await ensureServerSession({
      displayName: params.displayName,
      externalUid: auth.currentUser?.uid,
      authType: auth.currentUser ? 'firebase' : 'guest',
      avatarUrl: auth.currentUser?.photoURL || '',
    });

    const res = await safeJsonFetch<{ room: ClientRoomState }>('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: params.roomName,
        isPrivate: params.isPrivate,
        customInviteCode: params.customInviteCode,
        initialYoutubeId: params.initialYoutubeId,
        initialYoutubeTitle: params.initialYoutubeTitle,
      }),
    });

    let room: ClientRoomState;

    if (res.isServerUnavailable) {
      room = createFallbackRoom({
        actor: session.actor,
        name: params.roomName,
        isPrivate: params.isPrivate,
        customInviteCode: params.customInviteCode,
        initialYoutubeId: params.initialYoutubeId,
        initialYoutubeTitle: params.initialYoutubeTitle,
      });
    } else if (!res.ok || !res.data?.room) {
      throw new Error(res.error || 'Failed to create room.');
    } else {
      room = res.data.room;
    }

    setCreatedPendingRoom(room);

    // Mirror room creation to Firestore if signed in with Google
    mirrorRoomCreationToFirestore({
      id: room.id,
      name: room.name,
      inviteCode: room.inviteCode,
      isPrivate: room.isPrivate,
      isLocked: room.isLocked,
      activeMediaId: room.activeMediaId,
      activeMediaType: room.activeMediaType,
      activeMediaSource: room.activeMediaSource,
      activeMediaTitle: room.activeMediaTitle,
    }).catch(() => {});

    return {
      id: room.id,
      inviteCode: room.inviteCode,
      name: room.name,
      isPrivate: room.isPrivate,
    };
  };

  const handleEnterCreatedRoom = () => {
    if (!createdPendingRoom) return;
    setActiveRoom(createdPendingRoom);
    sessionStorage.setItem(ACTIVE_ROOM_ID_KEY, createdPendingRoom.id);
    window.history.replaceState(
      {},
      '',
      `/?room=${encodeURIComponent(createdPendingRoom.id)}&code=${encodeURIComponent(createdPendingRoom.inviteCode)}`
    );
    setCreatedPendingRoom(null);
    setCreateModalOpen(false);
  };

  // Join Room Flow (Public = Direct Join, Private = Send Join Request to Host)
  const handleJoinRoom = async (params: {
    roomCodeOrLink: string;
    displayName: string;
  }): Promise<JoinRoomResult> => {
    const session = await ensureServerSession({
      displayName: params.displayName,
      externalUid: auth.currentUser?.uid,
      authType: auth.currentUser ? 'firebase' : 'guest',
      avatarUrl: auth.currentUser?.photoURL || '',
    });

    const res = await safeJsonFetch<{
      status?: 'joined' | 'pending_approval';
      room?: ClientRoomState;
      roomId?: string;
      roomName?: string;
      inviteCode?: string;
      message?: string;
    }>('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomCodeOrLink: params.roomCodeOrLink,
      }),
    });

    if (res.isServerUnavailable) {
      const fallbackRes = joinFallbackRoom({
        actor: session.actor,
        roomCodeOrLink: params.roomCodeOrLink,
      });

      if (fallbackRes.status === 'pending_approval') {
        return {
          status: 'pending_approval',
          roomId: fallbackRes.roomId,
          roomName: fallbackRes.roomName,
          inviteCode: fallbackRes.inviteCode,
          message: fallbackRes.message,
        };
      }

      setActiveRoom(fallbackRes.room);
      sessionStorage.setItem(ACTIVE_ROOM_ID_KEY, fallbackRes.room.id);
      window.history.replaceState(
        {},
        '',
        `/?room=${encodeURIComponent(fallbackRes.room.id)}&code=${encodeURIComponent(fallbackRes.room.inviteCode)}`
      );
      setJoinModalOpen(false);
      return { status: 'joined' };
    }

    if (!res.ok || !res.data) {
      throw new Error(res.error || 'Could not join watch room.');
    }

    if (res.data.status === 'pending_approval' && res.data.roomId) {
      return {
        status: 'pending_approval',
        roomId: res.data.roomId,
        roomName: res.data.roomName || 'Private Watch Room',
        inviteCode: res.data.inviteCode || params.roomCodeOrLink.toUpperCase(),
        message: res.data.message || 'Join request sent to the room host. Waiting for approval...',
      };
    }

    if (res.data.room) {
      const room = res.data.room;
      setActiveRoom(room);
      sessionStorage.setItem(ACTIVE_ROOM_ID_KEY, room.id);
      window.history.replaceState(
        {},
        '',
        `/?room=${encodeURIComponent(room.id)}&code=${encodeURIComponent(room.inviteCode)}`
      );
      setJoinModalOpen(false);
      return { status: 'joined' };
    }

    throw new Error('Unexpected response while joining room.');
  };

  // Poll Private Room Join Request Status
  const handleCheckJoinRequestStatus = useCallback(
    async (
      roomId: string
    ): Promise<{ status: 'approved' | 'rejected' | 'pending'; error?: string }> => {
      if (!actor || !sessionToken) return { status: 'pending' };

      const res = await safeJsonFetch<{
        status: 'approved' | 'rejected' | 'pending';
        room?: ClientRoomState;
        error?: string;
      }>(`/api/rooms/${encodeURIComponent(roomId)}/join-status`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

      if (res.isServerUnavailable) {
        const fallbackCheck = checkFallbackJoinStatus({ roomId, actorId: actor.id });
        if (fallbackCheck.status === 'approved' && fallbackCheck.room) {
          setActiveRoom(fallbackCheck.room);
          sessionStorage.setItem(ACTIVE_ROOM_ID_KEY, fallbackCheck.room.id);
          window.history.replaceState(
            {},
            '',
            `/?room=${encodeURIComponent(fallbackCheck.room.id)}&code=${encodeURIComponent(
              fallbackCheck.room.inviteCode
            )}`
          );
          setJoinModalOpen(false);
        }
        return { status: fallbackCheck.status, error: fallbackCheck.error };
      }

      if (res.data?.status === 'approved' && res.data.room) {
        const room = res.data.room;
        setActiveRoom(room);
        sessionStorage.setItem(ACTIVE_ROOM_ID_KEY, room.id);
        window.history.replaceState(
          {},
          '',
          `/?room=${encodeURIComponent(room.id)}&code=${encodeURIComponent(room.inviteCode)}`
        );
        setJoinModalOpen(false);
        return { status: 'approved' };
      }

      if (res.data?.status === 'rejected') {
        return { status: 'rejected', error: res.data.error };
      }

      return { status: 'pending' };
    },
    [actor, sessionToken]
  );

  const handleLeaveRoom = (reason?: string) => {
    setActiveRoom(null);
    sessionStorage.removeItem(ACTIVE_ROOM_ID_KEY);
    window.history.replaceState({}, '', '/');
    if (reason) {
      setGlobalNotice(reason);
    }
  };

  return (
    <ErrorBoundary>
      {globalNotice && (
        <div className="fixed top-4 right-4 z-50 max-w-md bg-[#161626] border border-violet-500/40 rounded-xl p-4 shadow-2xl flex items-start justify-between gap-3 text-xs text-slate-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{globalNotice}</span>
          </div>
          <button
            onClick={() => setGlobalNotice(null)}
            className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeRoom && actor && sessionToken ? (
        <WatchRoomPage
          initialRoom={activeRoom}
          actor={actor}
          sessionToken={sessionToken}
          onLeaveRoom={handleLeaveRoom}
        />
      ) : (
        <LandingPage
          onOpenCreateRoom={() => setCreateModalOpen(true)}
          onOpenJoinRoom={() => setJoinModalOpen(true)}
          onOpenInfoModal={(sec) => setInfoSection(sec)}
          currentUser={actor}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
        />
      )}

      <CreateRoomModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        defaultDisplayName={actor?.displayName || ''}
        isAuthenticatedUser={Boolean(actor && actor.authType !== 'guest')}
        onCreateRoom={handleCreateRoom}
        onEnterCreatedRoom={handleEnterCreatedRoom}
      />

      <JoinRoomModal
        isOpen={joinModalOpen}
        onClose={() => setJoinModalOpen(false)}
        initialCodeOrLink={initialJoinCode}
        defaultDisplayName={actor?.displayName || ''}
        onJoinRoom={handleJoinRoom}
        onCheckJoinRequestStatus={handleCheckJoinRequestStatus}
      />

      <InfoModal
        section={infoSection}
        onClose={() => setInfoSection(null)}
        configStatus={configStatus}
      />
    </ErrorBoundary>
  );
}
