/**
 * Deterministic anonymous display name generator.
 *
 * Given a user_id + post_id, always produces the same display name.
 * Different post_id → different name for the same user.
 * No way to reverse-engineer the user_id from the name.
 *
 * Format: "Adjective Noun" (e.g., "Crimson Pelican", "Silent River")
 */

const ADJECTIVES = [
  "Amber", "Bold", "Bright", "Calm", "Clever",
  "Coral", "Crimson", "Daring", "Dusky", "Eager",
  "Faint", "Fierce", "Gentle", "Golden", "Hasty",
  "Hidden", "Idle", "Ivory", "Jade", "Keen",
  "Lively", "Lunar", "Misty", "Noble", "Opal",
  "Pale", "Quick", "Quiet", "Rustic", "Sage",
  "Sharp", "Silent", "Solar", "Swift", "Tidal",
  "Twilit", "Vast", "Velvet", "Vivid", "Wandering",
  "Wary", "Wild", "Windy", "Wistful", "Wooden",
  "Young", "Zealous", "Mossy", "Frosty", "Dusty",
  "Scarlet", "Azure", "Copper", "Dappled", "Ember",
  "Flint", "Granite", "Hollow", "Indigo", "Jasper",
  "Kindled", "Lichen", "Marble", "Nimble", "Obsidian",
];

const NOUNS = [
  "Badger", "Brook", "Canyon", "Crane", "Cypress",
  "Dune", "Eagle", "Falcon", "Fern", "Finch",
  "Fox", "Glacier", "Grove", "Hawk", "Heron",
  "Lark", "Lantern", "Lynx", "Maple", "Marsh",
  "Meadow", "Moon", "Moth", "Oak", "Otter",
  "Owl", "Pelican", "Pebble", "Pine", "Pond",
  "Quail", "Raven", "Reef", "Ridge", "River",
  "Robin", "Sage", "Seal", "Shade", "Shore",
  "Sparrow", "Stone", "Summit", "Swan", "Thistle",
  "Thicket", "Tiger", "Trail", "Violet", "Wren",
  "Anchor", "Beacon", "Birch", "Cedar", "Cinder",
  "Cobalt", "Compass", "Coyote", "Drift", "Eclipse",
  "Flicker", "Garnet", "Harbor", "Iris", "Juniper",
];

/**
 * Simple string hash (djb2 variant).
 * Produces a positive 32-bit integer from any string.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  // Ensure positive
  return Math.abs(hash);
}

/**
 * Generate a deterministic display name for a user within a specific post.
 *
 * The same (userId, postId) pair always returns the same name.
 * The same userId with a different postId returns a different name.
 */
export function generateDisplayName(
  userId: string,
  postId: string
): string {
  // Combine user and post IDs with a separator that can't appear in UUIDs
  const combined = `${userId}||${postId}`;
  const hash = hashString(combined);

  // Use different bits of the hash for adjective and noun
  const adjIndex = hash % ADJECTIVES.length;
  const nounIndex = Math.floor(hash / ADJECTIVES.length) % NOUNS.length;

  return `${ADJECTIVES[adjIndex]} ${NOUNS[nounIndex]}`;
}
