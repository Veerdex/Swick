// Client-side mirrors of the data the server sends.

export interface RoomSummary {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  started: boolean;
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
  handCount: number;
  hand: CardSlot[];
}

export interface GameView {
  roundState: string;
  anteAmount: number;
  anteSet: boolean;
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
  started: boolean;
  canStart: boolean;
  /** The viewer's own player id (matches one of state.players[].id). */
  youId: string;
  state: GameView;
}

/** Standard ack shape for room actions. */
export interface ActionAck {
  ok: boolean;
  error?: string;
  roomId?: string;
}
