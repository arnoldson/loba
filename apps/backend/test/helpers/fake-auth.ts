/**
 * Fake Supabase token verification. A token is "valid" iff it was minted
 * by tokenFor(); anything else is rejected the way Supabase rejects a bad
 * or expired JWT. test/setup.ts wires `getUser` in as the mocked
 * supabase-js client's auth.getUser.
 */
const PREFIX = "test-token-"

export const tokenFor = (userId: string) => `${PREFIX}${userId}`

export const authHeader = (userId: string) => ({
  authorization: `Bearer ${tokenFor(userId)}`,
})

export async function getUser(token: string) {
  if (!token.startsWith(PREFIX)) {
    return { data: { user: null }, error: { message: "invalid JWT" } }
  }
  return { data: { user: { id: token.slice(PREFIX.length) } }, error: null }
}
