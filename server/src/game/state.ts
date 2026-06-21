// The authoritative SWICK game state.
//
// This is the single source of truth for a room's game. Every later phase
// (dealing, knock-in, discard, trick-taking, set calculation) reads and writes
// this object, and the client renders from a (filtered) copy of it.
//
// Phase 3 defines the SHAPE and sensible defaults only. State transitions live
// in later phases (see stateMachine.ts / rules.ts when they arrive).

import type { Card, Suit, Rank } from "./cards.js";

/** Phases of a single hand. Drives the whole game. See SWICK_DEV_GUIDE.md. */
export type RoundState =
  | "idle" // between hands; lobby/ante
  | "dealing" // cards going out
  | "trump-selection" // dealer decides keep/pass on the flipped trump
  | "knock-in" // players go clockwise, knock or pass
  | "discard-draw" // players go clockwise, dealer last
  | "turns" // a trick is being played
  | "trick-complete" // a trick just finished
  | "end"; // hand over: set calc + payout, then back to idle

export type SetType = "single" | "double";

/** Minimum ante per player, in cents. The dealer antes this much extra. */
export const MIN_ANTE = 3;

/** Fake-money starting balance for a fresh player, in cents. */
export const STARTING_MONEY = 1000;

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;

  /** Running fake-money balance, in cents. */
  money: number;

  // --- Per-hand fields (reset at the start of each hand) ---
  hand: Card[];
  isDealer: boolean;
  knockedIn: boolean;
  /** Action gates — prevent the same decision being processed twice. */
  hasKnockDecision: boolean;
  hasDiscardDecision: boolean;
  tricksWon: number;
  wentSet: boolean;
  setType: SetType | null;
  setAmount: number;

  /** Lobby readiness — set in the room before a hand starts. */
  ready: boolean;

  /** Connection tracking (matters for reconnect handling later). */
  connected: boolean;
}

/** A card played into the current trick, tagged with who played it. */
export interface PlayedCard {
  playerId: string;
  card: Card;
}

export interface GameState {
  roundState: RoundState;
  players: PlayerState[];

  // --- Pot / betting (potValue must ALWAYS be divisible by 3) ---
  /** Ante per player for this hand, set by the dealer/host. */
  anteAmount: number;
  /** Whether the ante has been explicitly set; players can't ready before this. */
  anteSet: boolean;
  /** Current pot in cents. Invariant: potValue % 3 === 0. */
  potValue: number;
  /** Set penalties carried into the next hand's pot. */
  nextRoundPotBonus: number;

  // --- Trump ---
  trumpSuit: Suit | null;
  trumpCard: Card | null;
  dealerKeptTrump: boolean;
  /** Rank of the kept trump card (drives the dealer face-trump rule). */
  dealerTrumpValue: Rank | null;
  /**
   * The dealer is blind to their dealt cards until their discard turn. This
   * flips true when that turn begins; until then the filter hides the dealer's
   * hand (showing only a kept trump card, which is public).
   */
  dealerHandRevealed: boolean;

  // --- Turn pointers (whose turn it is, per phase) ---
  dealerId: string | null;
  currentTurnPlayerId: string | null;
  currentKnockPlayerId: string | null;
  currentDiscardPlayerId: string | null;

  // --- Trick-taking ---
  /** Which trick we're on, 0-based (0, 1, 2 for the three tricks). */
  trickNumber: number;
  /** Cards played in the trick currently in progress. */
  currentTrick: PlayedCard[];
  /** Suit that was led in the current trick. */
  leadSuit: Suit | null;

  // --- Outcomes ---
  /** Player id holding a special hand (3 Aces, 3 Sevens, A-K-Q trump). */
  specialHandWinner: string | null;

  // --- Server-only ---
  /**
   * The undealt deck / draw stock. Authoritative and server-only — this is
   * stripped before state is sent to clients (along with opponents' hands and
   * the dealer's hidden cards). Filtering lives in the socket layer.
   */
  deck: Card[];
}

/** Create a fresh player with default per-hand fields and a starting balance. */
export function createPlayer(
  id: string,
  name: string,
  isBot = false,
): PlayerState {
  return {
    id,
    name,
    isBot,
    money: STARTING_MONEY,
    hand: [],
    isDealer: false,
    knockedIn: false,
    hasKnockDecision: false,
    hasDiscardDecision: false,
    tricksWon: 0,
    wentSet: false,
    setType: null,
    setAmount: 0,
    ready: false,
    connected: true,
  };
}

/** Reset a player's per-hand fields, preserving identity and money balance. */
export function resetPlayerForHand(player: PlayerState): void {
  player.hand = [];
  player.isDealer = false;
  player.knockedIn = false;
  player.hasKnockDecision = false;
  player.hasDiscardDecision = false;
  player.tricksWon = 0;
  player.wentSet = false;
  player.setType = null;
  player.setAmount = 0;
  player.ready = false;
}

/** Create an idle game state, optionally seeded with players. */
export function createGameState(players: PlayerState[] = []): GameState {
  return {
    roundState: "idle",
    players,

    anteAmount: MIN_ANTE,
    anteSet: false,
    potValue: 0,
    nextRoundPotBonus: 0,

    trumpSuit: null,
    trumpCard: null,
    dealerKeptTrump: false,
    dealerTrumpValue: null,
    dealerHandRevealed: false,

    dealerId: null,
    currentTurnPlayerId: null,
    currentKnockPlayerId: null,
    currentDiscardPlayerId: null,

    trickNumber: 0,
    currentTrick: [],
    leadSuit: null,

    specialHandWinner: null,

    deck: [],
  };
}

/** The pot must always be divisible by 3 (each of the 3 tricks is worth 1/3). */
export function isPotDivisible(pot: number): boolean {
  return Number.isInteger(pot) && pot % 3 === 0;
}

/**
 * Guard the pot invariant. Call after any change that touches the pot; a
 * thrown error here means a rule was implemented wrong, not a player mistake.
 */
export function assertPotValid(pot: number): void {
  if (!isPotDivisible(pot)) {
    throw new Error(`Pot invariant violated: ${pot} is not divisible by 3`);
  }
}

/** Look up a player by id, or undefined if not present. */
export function getPlayer(
  state: GameState,
  playerId: string,
): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}
