import {
  sanitizeProfileMetadata,
  type Profile,
  type ProfileMetadata,
} from "@/types/profile";

/**
 * Backend origin for browser calls. Override in `.env.local`:
 * `NEXT_PUBLIC_RustAcademy_API_URL=https://api.example.com`
 */
export const getRustAcademyApiBase = (): string =>
  process.env.NEXT_PUBLIC_RustAcademy_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

/**
 * localStorage key that holds user-curated profile metadata. The key is
 * normalized to lowercase so refreshes and case variations of a username
 * always resolve to the same stored record.
 */
export function getProfileStorageKey(username: string): string {
  return `profile_${username.toLowerCase()}`;
}

interface BackendPublicProfile {
  id: string;
  username: string;
  publicKey: string;
  lastActiveAt: string;
  createdAt: string;
  similarityScore?: number;
}

interface SearchResponse {
  profiles: BackendPublicProfile[];
  total: number;
  next_cursor?: string;
  has_more: boolean;
}

/**
 * Profile not found error
 */
export class ProfileNotFoundError extends Error {
  constructor(username: string) {
    super(`Profile not found: ${username}`);
    this.name = "ProfileNotFoundError";
  }
}

/**
 * Read and sanitize the locally stored profile metadata for `username`.
 *
 * Recovers gracefully from malformed data:
 * - invalid JSON or a non-object payload is discarded (and removed) and the
 *   defaults are returned,
 * - invalid individual fields are dropped and replaced with defaults,
 * - no throw is ever surfaced to callers.
 */
export function readStoredProfileMetadata(
  username: string,
): ProfileMetadata {
  if (typeof window === "undefined") {
    return sanitizeProfileMetadata(null);
  }

  const storageKey = getProfileStorageKey(username);
  const stored = window.localStorage.getItem(storageKey);

  if (!stored) {
    return sanitizeProfileMetadata(null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (e) {
    // Corrupt payload — drop it so it doesn't keep failing on future loads.
    console.error(
      `Failed to parse stored profile metadata for "${username}":`,
      e,
    );
    window.localStorage.removeItem(storageKey);
    return sanitizeProfileMetadata(null);
  }

  const metadata = sanitizeProfileMetadata(parsed);

  // If the stored value parsed but was unusable (e.g. a string/number/array),
  // clean it up so the next load is deterministic.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    window.localStorage.removeItem(storageKey);
  }

  return metadata;
}

/**
 * Fetch a public user profile by username from the backend API.
 * 
 * @throws {ProfileNotFoundError} When the username doesn't exist or profile is private
 * @throws {Error} For network or API errors
 */
export async function getProfile(username: string): Promise<Profile> {
  const baseUrl = getRustAcademyApiBase();
  
  try {
    // Search for exact username match using the search endpoint
    const response = await fetch(
      `${baseUrl}/username/search?query=${encodeURIComponent(username)}&limit=1`
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data: SearchResponse = await response.json();

    // Check if we found an exact match
    const profile = data.profiles.find(
      (p) => p.username.toLowerCase() === username.toLowerCase()
    );

    if (!profile) {
      throw new ProfileNotFoundError(username);
    }

    // Merge sanitized localStorage metadata (colors, bio, social handles)
    // with the backend profile. Malformed local data is dropped per-field.
    const metadata = readStoredProfileMetadata(username);

    return {
      username: profile.username,
      publicKey: profile.publicKey,
      ...metadata,
    };
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      throw error;
    }
    
    // Network or other errors
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error("Unable to connect to the backend. Please check your connection.");
    }
    
    throw error;
  }
}

/**
 * Simulate API call to save a user profile, persisting to localStorage.
 */
export async function saveProfile(profile: Profile): Promise<Profile> {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (typeof window !== "undefined") {
    const sanitized: Profile = {
      ...profile,
      username: profile.username.toLowerCase(),
      ...sanitizeProfileMetadata(profile),
    };
    window.localStorage.setItem(
      getProfileStorageKey(sanitized.username),
      JSON.stringify(sanitized),
    );
    return sanitized;
  }
  return profile;
}
