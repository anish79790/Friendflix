# FriendsFlix Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false`).
2. **Email Verification & Identity Integrity**: All writes require `request.auth != null` and `request.auth.token.email_verified == true`. All `uid`, `hostId` (on create), `userId`, `senderId`, and `addedBy` fields must strictly equal `request.auth.uid`.
3. **PII Isolation**: `/users/{userId}` stores only public display metadata (`uid`, `displayName`, `avatarUrl`, `createdAt`, `updatedAt`) and never stores emails or phone numbers. Read access is restricted to the profile owner.
4. **Master Gate & Relational Sync**: Subcollections (`/rooms/{roomId}/members/{memberId}`, `/rooms/{roomId}/messages/{messageId}`, `/rooms/{roomId}/queue/{queueId}`) require verified membership in the parent `/rooms/{roomId}` document and verify that the parent room exists and is in `status == 'active'`.
5. **Atomicity on Room Creation**: Creating `/rooms/{roomId}` requires `existsAfter(/databases/$(database)/documents/rooms/$(roomId)/members/$(request.auth.uid))` so a room cannot exist without its host member record created in the same batch.
6. **Terminal State Locking**: Once a room reaches `status == 'ended'`, no further updates are permitted on `/rooms/{roomId}` or its subcollections.
7. **Strict Key & Size Enforcement**: Every entity validation helper enforces `hasAll` and `hasOnly` on keys, regex pattern checks on IDs (`^[a-zA-Z0-9_\-]+$`), and explicit `.size()` boundaries on every string field.
8. **Secure List Queries**: Every `allow list` rule evaluates `resource.data` against `request.auth.uid` without any `get()` or `exists()` calls inside `list`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Identity Spoofing on Room Create)**: Authenticated user `user_attacker` attempts to create `/rooms/room_01` with `hostId: "user_victim"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Unverified Email Write)**: User with `email_verified: false` attempts to create `/users/user_unverified`. -> `PERMISSION_DENIED`
3. **Payload 3 (Shadow Field Injection on Room Update)**: Host updates `/rooms/room_01` with an undeclared field `isSuperRoom: true`. -> `PERMISSION_DENIED`
4. **Payload 4 (Orphaned Room Creation without Host Membership)**: User creates `/rooms/room_orphan` without atomically creating `/rooms/room_orphan/members/{uid}` in the same batch. -> `PERMISSION_DENIED`
5. **Payload 5 (Privilege Escalation in RoomMember)**: Participant `user_guest` attempts to join `/rooms/room_01/members/user_guest` with `role: "host"`. -> `PERMISSION_DENIED`
6. **Payload 6 (Locked Room Bypass)**: User `user_intruder` attempts to create `/rooms/room_locked/members/user_intruder` when parent room has `isLocked: true`. -> `PERMISSION_DENIED`
7. **Payload 7 (Terminal State Mutation)**: Host attempts to update `playbackPosition` on `/rooms/room_ended` where `status == "ended"`. -> `PERMISSION_DENIED`
8. **Payload 8 (Non-Member Chat Injection)**: Authenticated user `user_outsider` (not in `/rooms/room_01/members`) attempts to create `/rooms/room_01/messages/msg_01`. -> `PERMISSION_DENIED`
9. **Payload 9 (Denial-of-Wallet Oversized Chat Message)**: Room member sends a chat message with a 2,000-character `message` string (exceeding `maxLength: 500`). -> `PERMISSION_DENIED`
10. **Payload 10 (Unauthorized Queue Manipulation)**: Non-host participant attempts to create or reorder `/rooms/room_01/queue/q_01`. -> `PERMISSION_DENIED`
11. **Payload 11 (Timestamp Forgery)**: User attempts to create a chat message with a backdated `createdAt` timestamp instead of `request.time`. -> `PERMISSION_DENIED`
12. **Payload 12 (Immutable Field Tampering)**: Host attempts to mutate `createdAt` or `inviteCode` on `/rooms/room_01` during an update. -> `PERMISSION_DENIED`
