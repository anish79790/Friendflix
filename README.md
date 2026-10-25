# FriendsFlix — Full-Stack Synchronized Watch Party Web Application

**Tagline:** *Your friends. Your movie night.*

FriendsFlix is a responsive, full-stack watch party web application where friends can watch embedded YouTube videos or private uploaded video files (`.mp4` and `.webm`) together in synchronized rooms while communicating over peer-to-peer WebRTC group voice chat and real-time messaging.

---

## 1. Architecture & Technology Stack (Pure Firebase + Node/Express/WebSocket)

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons.
- **Authentication & Persistent Cloud Database:**
  - **Firebase Authentication:** Google Sign-In (`signInWithPopup`) pre-configured via `firebase-applet-config.json`.
  - **Cloud Firestore:** Provisioned database (`ai-studio-87e97084-26d9-4e62-88b2-da0db4aaefeb`) with Zero-Trust Attribute-Based Access Control (`firestore.rules`).
- **Real-Time Room Server & Private Media Engine (`server.ts`):**
  - Runs Express + WebSocket (`ws`) on port `3000`.
  - Issues HMAC-SHA256 signed session tokens (`Authorization: Bearer <token>`) for both Google-authenticated users and Guest participants.
  - Handles private MP4/WebM uploads (up to 50 MB) with binary magic-byte header verification and streams them exclusively to verified room members via 15-minute signed HTTP Range URLs (`206 Partial Content`).
- **Voice Calling:** Native Browser WebRTC (`RTCPeerConnection`, `getUserMedia`, WebAudio `AnalyserNode` speaking detector) using a peer-to-peer mesh topology (up to 4 active voice participants) with room-scoped WebSocket signaling.

---

## 2. Deployment Checklist

1. **In Google AI Studio / Cloud Run (1-Click Deploy):**
   - `firebase-applet-config.json` and `firestore.rules` are already provisioned and deployed.
   - Click **Deploy** in AI Studio — it automatically builds the frontend (`npm run build`) and starts the full-stack server (`npm start` -> `node server.ts`) on port `3000`.
2. **If Deploying to an External Host (Render / Railway / VPS / Own Cloud Run):**
   - Set `SESSION_SIGNING_SECRET` to a random 32-byte hex string in your environment variables.
   - In the **Firebase Console -> Authentication -> Settings -> Authorized domains**, add your custom production domain so Google Sign-In popups are permitted on that domain.
   - Run `npm install && npm run build && npm start`.

---

## 3. Free-Tier Operational Limits

- **Room Size:** Maximum **8 participants** per room.
- **Voice Calling:** Maximum **4 concurrent voice participants** per room (peer-to-peer WebRTC mesh).
- **Private Video Uploads:** Maximum **50 MB per file** (`.mp4` and `.webm`). Uploaded files are automatically deleted when a room is ended or expires after 120 minutes of inactivity.
