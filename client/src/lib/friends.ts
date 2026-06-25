import { socket } from "./socket";

// Friends are owned by the server (a private DB table). The client only reads
// the list and sends requests/responses over the socket.

export interface Friend {
  id: string;
  username: string;
  status: "pending" | "accepted";
  /** For pending only: true if they sent the request to me (I can accept). */
  incoming: boolean;
}

export type AddFriendResult =
  | "sent"
  | "accepted"
  | "already_friends"
  | "already_pending"
  | "self"
  | "not_found"
  | "error";

interface ListAck {
  ok: boolean;
  error?: string;
  friends?: Friend[];
  result?: AddFriendResult;
}

/** Fetch my friends + pending requests. */
export function listFriends(): Promise<Friend[]> {
  return new Promise((resolve) => {
    socket.emit("friends:list", (a: ListAck) => resolve(a?.friends ?? []));
  });
}

/** Send a friend request by username; returns the outcome + refreshed list. */
export function addFriend(
  username: string,
): Promise<{ result: AddFriendResult; friends: Friend[] }> {
  return new Promise((resolve) => {
    socket.emit("friends:add", { username }, (a: ListAck) =>
      resolve({
        result: a?.ok ? (a.result ?? "error") : "error",
        friends: a?.friends ?? [],
      }),
    );
  });
}

/** Accept or decline an incoming request; returns the refreshed list. */
export function respondFriend(userId: string, accept: boolean): Promise<Friend[]> {
  return new Promise((resolve) => {
    socket.emit("friends:respond", { userId, accept }, (a: ListAck) =>
      resolve(a?.friends ?? []),
    );
  });
}

/** Remove a friend (or cancel a pending request); returns the refreshed list. */
export function removeFriend(userId: string): Promise<Friend[]> {
  return new Promise((resolve) => {
    socket.emit("friends:remove", { userId }, (a: ListAck) =>
      resolve(a?.friends ?? []),
    );
  });
}
