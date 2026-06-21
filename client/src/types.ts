// Client-side mirrors of the data the server sends. These intentionally cover
// only the fields the lobby UI uses (the full GameState arrives in later phases).

export interface RoomSummary {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  started: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  money: number;
  ready: boolean;
  isDealer: boolean;
}

export interface RoomView {
  id: string;
  name: string;
  hostId: string;
  started: boolean;
  canStart: boolean;
  state: {
    roundState: string;
    anteAmount: number;
    anteSet: boolean;
    potValue: number;
    players: PlayerView[];
  };
}

/** Standard ack shape for room actions. */
export interface ActionAck {
  ok: boolean;
  error?: string;
  roomId?: string;
}
