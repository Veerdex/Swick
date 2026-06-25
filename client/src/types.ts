// Client-side mirrors of the data the server sends.

export type GameMode = "casual" | "gamble";

export interface RoomSummary {
  id: string;
  name: string;
  mode: GameMode;
  /** Hidden from non-friends of the host (only friends see it in the list). */
  friendsOnly: boolean;
  playerCount: number;
  maxPlayers: number;
  spectatorCount: number;
  /** Current pot — a gamble table needs your balance to exceed this to join. */
  pot: number;
  started: boolean;
  /** A started game that dropped below the minimum and is open to refill. */
  needsPlayers: boolean;
}

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank = "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

/** A card slot in a hand: the card if visible, or null if face-down. */
export type CardSlot = Card | null;

export interface PlayedCard {
  playerId: string;
  card: Card;
}

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  money: number;
  ready: boolean;
  isDealer: boolean;
  knockedIn: boolean;
  hasKnockDecision: boolean;
  hasDiscardDecision: boolean;
  tricksWon: number;
  wentSet: boolean;
  setType: "single" | "double" | null;
  setAmount: number;
  /** False while disconnected — a bot plays their seat until they return. */
  connected: boolean;
  handCount: number;
  hand: CardSlot[];
}

export interface GameView {
  roundState: string;
  anteAmount: number;
  anteSet: boolean;
  /** Decision-time multiplier: 0.5 / 1 / 2 / 5, or 0 = Infinite (no limit). */
  decisionMult: number;
  potValue: number;
  nextRoundPotBonus: number;

  trumpSuit: Suit | null;
  trumpCard: Card | null;
  dealerKeptTrump: boolean;
  dealerTrumpValue: Rank | null;
  dealerTrimPending: boolean;

  dealerId: string | null;
  currentTurnPlayerId: string | null;
  currentKnockPlayerId: string | null;
  currentDiscardPlayerId: string | null;

  trickNumber: number;
  currentTrick: PlayedCard[];
  leadSuit: Suit | null;
  trickWinnerId: string | null;

  specialHandWinner: string | null;
  specialHandType: string | null;
  lastDiscard: { playerId: string; out: number; in: number; seq: number } | null;

  deckCount: number;
  /** Hand indices the viewer may legally play right now (empty if not their turn). */
  yourLegalPlays: number[];
  players: PlayerView[];
}

export interface RoomView {
  id: string;
  name: string;
  hostId: string;
  mode: GameMode;
  started: boolean;
  canStart: boolean;
  /** The viewer's own player id (matches one of state.players[].id). */
  youId: string;
  /** True when watching (not seated) — all hands are hidden and no actions. */
  isSpectator: boolean;
  /**
   * True when sitting out the current hand because you can't cover the pot
   * (gamble mode). A subset of isSpectator — you auto-rejoin when affordable.
   */
  isSittingOut: boolean;
  state: GameView;
}

/** Standard ack shape for room actions. */
export interface ActionAck {
  ok: boolean;
  error?: string;
  roomId?: string;
}
