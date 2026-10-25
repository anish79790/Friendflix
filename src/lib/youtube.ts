/**
 * Safely parses common YouTube URL formats or 11-character video IDs.
 * Rejects non-YouTube URLs, malformed strings, or script injection attempts.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Direct 11-character YouTube ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const normalizedUrl =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
    const url = new URL(normalizedUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      if (
        pathParts.length >= 2 &&
        (pathParts[0] === 'embed' || pathParts[0] === 'shorts' || pathParts[0] === 'live' || pathParts[0] === 'v')
      ) {
        const candidate = pathParts[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export interface CuratedVideoPreset {
  id: string;
  title: string;
  durationLabel: string;
  category: string;
}

export const CURATED_YOUTUBE_PRESETS: CuratedVideoPreset[] = [
  {
    id: 'aqz-KE-bpKQ',
    title: 'Big Buck Bunny 60fps 4K — Blender Open Movie',
    durationLabel: '10:34',
    category: 'Animation · Open Film',
  },
  {
    id: 'eRsGyueVLvQ',
    title: 'Sintel — Third Open Movie by Blender Foundation',
    durationLabel: '14:48',
    category: 'Fantasy · Short Film',
  },
  {
    id: 'R6MlUcmOul8',
    title: 'Tears of Steel — Sci-Fi Live Action & VFX Short',
    durationLabel: '12:14',
    category: 'Sci-Fi · Cinema',
  },
  {
    id: 'mN0zPOpADL4',
    title: 'Spring — Blender Open Movie Short Film',
    durationLabel: '07:44',
    category: 'Animated · Atmospheric',
  },
];
