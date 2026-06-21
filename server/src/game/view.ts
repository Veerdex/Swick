// Per-player state filtering. The server holds the full truth; each client may
// only see what it's allowed to. This is where hidden information is enforced:
//
//   - the draw stock is never sent (only its count),
//   - opponents' hands are face-down (rendered as nulls),
//   - the dealer is BLIND to their own dealt cards until their discard turn —
//     they see only a kept trump card (which is public) until then.
//
// Pure functions over a GameState, so the rules are unit-testable.

import { type Card, cardsEqual } from "./cards.js";
import type { GameState, PlayerState } from "./state.js";
import { legalPlays } from "./tricks.js";

/** A card slot in a hand view: the card if visible, or null if face-down. */
export type CardSlot = Card | null;

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
  setType: PlayerState["setType"];
  setAmount: number;
  /** How many cards are in the hand (always visible). */
  handCount: number;
  /** The hand, with hidden cards as null. */
  hand: CardSlot[];
}

export interface GameView {
  roundState: GameState["roundState"];
  anteAmount: number;
  anteSet: boolean;
  potValue: number;
  nextRoundPotBonus: number;

  trumpSuit: GameState["trumpSuit"];
  trumpCard: GameState["trumpCard"];
  dealerKeptTrump: boolean;
  dealerTrumpValue: GameState["dealerTrumpValue"];
  dealerTrimPending: boolean;

  dealerId: string | null;
  currentTurnPlayerId: string | null;
  currentKnockPlayerId: string | null;
  currentDiscardPlayerId: string | null;

  trickNumber: number;
  currentTrick: GameState["currentTrick"];
  leadSuit: GameState["leadSuit"];

  specialHandWinner: string | null;
  specialHandType: string | null;

  /** Cards left in the draw stock (count only — never the cards). */
  deckCount: number;

  /** Hand indices the viewer may legally play right now (empty if not their turn). */
  yourLegalPlays: number[];

  players: PlayerView[];
}

/**
 * Whether `viewer` may see the actual cards in `owner`'s hand.
 * - You always see your own hand, UNLESS you're the dealer who's still blind.
 * - A blind dealer sees nothing of their own hand here (the kept trump is added
 *   back separately by buildHandView).
 * - You never see anyone else's hand.
 */
function canSeeOwnerHand(
  state: GameState,
  viewerId: string,
  owner: PlayerState,
): boolean {
  if (owner.id !== viewerId) return false;
  if (owner.isDealer && !state.dealerHandRevealed) return false;
  return true;
}

/** Build the hand view for one player from a given viewer's perspective. */
function buildHandView(
  state: GameState,
  viewerId: string,
  owner: PlayerState,
): CardSlot[] {
  if (canSeeOwnerHand(state, viewerId, owner)) {
    return owner.hand.map((card) => card);
  }

  // Hidden by default. The one exception: the dealer (viewing their own blind
  // hand) still sees the kept trump card, which is face-up and public.
  const showKeptTrump =
    owner.id === viewerId &&
    owner.isDealer &&
    state.dealerKeptTrump &&
    state.trumpCard !== null;

  return owner.hand.map((card) =>
    showKeptTrump && state.trumpCard && cardsEqual(card, state.trumpCard)
      ? card
      : null,
  );
}

function buildPlayerView(
  state: GameState,
  viewerId: string,
  owner: PlayerState,
): PlayerView {
  return {
    id: owner.id,
    name: owner.name,
    isBot: owner.isBot,
    money: owner.money,
    ready: owner.ready,
    isDealer: owner.isDealer,
    knockedIn: owner.knockedIn,
    hasKnockDecision: owner.hasKnockDecision,
    hasDiscardDecision: owner.hasDiscardDecision,
    tricksWon: owner.tricksWon,
    wentSet: owner.wentSet,
    setType: owner.setType,
    setAmount: owner.setAmount,
    handCount: owner.hand.length,
    hand: buildHandView(state, viewerId, owner),
  };
}

/** Produce the filtered game view for a specific viewer. */
export function viewFor(state: GameState, viewerId: string): GameView {
  return {
    roundState: state.roundState,
    anteAmount: state.anteAmount,
    anteSet: state.anteSet,
    potValue: state.potValue,
    nextRoundPotBonus: state.nextRoundPotBonus,

    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    dealerKeptTrump: state.dealerKeptTrump,
    dealerTrumpValue: state.dealerTrumpValue,
    dealerTrimPending: state.dealerTrimPending,

    dealerId: state.dealerId,
    currentTurnPlayerId: state.currentTurnPlayerId,
    currentKnockPlayerId: state.currentKnockPlayerId,
    currentDiscardPlayerId: state.currentDiscardPlayerId,

    trickNumber: state.trickNumber,
    currentTrick: state.currentTrick,
    leadSuit: state.leadSuit,

    specialHandWinner: state.specialHandWinner,
    specialHandType: state.specialHandType,

    deckCount: state.deck.length,

    yourLegalPlays:
      state.roundState === "turns" && state.currentTurnPlayerId === viewerId
        ? legalPlays(state, viewerId)
        : [],

    players: state.players.map((p) => buildPlayerView(state, viewerId, p)),
  };
}
