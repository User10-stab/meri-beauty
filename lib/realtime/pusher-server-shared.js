/**
 * Pure utility shared between server and client code for constructing
 * the private Pusher channel name reserved for a specific user.
 *
 * Kept separate from pusher-server.js because the client hook also needs
 * this function, but the client must NOT import the server-only module
 * (it depends on the `pusher` Node SDK + Prisma, which would blow up the
 * browser bundle).
 *
 * Pusher convention: private channels start with "private-" so the client
 * is forced to hit the auth endpoint before it can subscribe.
 *
 * @param {string} userId
 * @returns {string}
 */
export function userChannelName(userId) {
  return `private-user-${userId}`;
}
