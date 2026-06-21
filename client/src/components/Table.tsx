import { useState } from "react";
import { socket } from "../lib/socket";
import Card from "./Card";
import type { ActionAck, CardSlot, RoomView } from "../types";

interface TableProps {
  room: RoomView;
}

/** The in-hand game table: pot, trump, seats, your hand, and dealer controls. */
export default function Table({ room }: TableProps) {
  const [error, setError] = useState<string | null>(null);
  const { state, youId } = room;
  const me = state.players.find((p) => p.id === youId);
  const iAmDealer = state.dealerId === youId;
  // If any of my own cards are still hidden, I'm a blind dealer.
  const iAmBlind = iAmDealer && (me?.hand.some((c) => c === null) ?? false);

  const isHost = room.hostId === youId;
  const myTurnToKnock =
    state.roundState === "knock-in" && state.currentKnockPlayerId === youId;

  const ack = (a: ActionAck) => setError(a.ok ? null : a.error ?? "Action failed");
  const keepTrump = (keep: boolean) =>
    socket.emit("room:keepTrump", { keep }, ack);
  const knock = (k: boolean) => socket.emit("room:knock", { knock: k }, ack);
  const nextHand = () => socket.emit("room:nextHand", ack);

  const knockStatus = (p: (typeof state.players)[number]): string => {
    if (!p.hasKnockDecision) {
      return state.currentKnockPlayerId === p.id ? "deciding…" : "—";
    }
    return p.knockedIn ? "knocked in" : "passed";
  };

  return (
    <div className="w-full max-w-2xl space-y-5">
      {/* Pot + trump header */}
      <div className="flex items-center justify-between rounded-xl bg-slate-800 p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Pot</p>
          <p className="text-2xl font-bold text-emerald-300">{state.potValue}¢</p>
          <p className="text-xs text-slate-500">
            phase: {state.roundState} · {state.deckCount} in deck
          </p>
        </div>
        <div className="flex flex-col items-center">
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">
            Trump{" "}
            {state.dealerKeptTrump
              ? "(kept)"
              : state.roundState !== "trump-selection"
                ? "(on table)"
                : ""}
          </p>
          <Card card={state.trumpCard} highlight size="sm" />
        </div>
      </div>

      {/* Seats */}
      <div className="rounded-xl bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-semibold">Players</h2>
        <ul className="space-y-2">
          {state.players.map((p) => {
            const isTurn =
              state.currentTurnPlayerId === p.id ||
              state.currentKnockPlayerId === p.id ||
              state.currentDiscardPlayerId === p.id;
            return (
              <li
                key={p.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  isTurn ? "bg-amber-500/15 ring-1 ring-amber-500/40" : "bg-slate-700/60"
                }`}
              >
                <span className="flex items-center gap-2 text-sm">
                  {p.name}
                  {p.id === youId && (
                    <span className="text-xs text-slate-400">(you)</span>
                  )}
                  {p.isDealer && (
                    <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
                      DEALER
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3 text-xs text-slate-400">
                  {state.roundState === "knock-in" && (
                    <span
                      className={
                        p.hasKnockDecision && p.knockedIn
                          ? "text-emerald-300"
                          : p.hasKnockDecision
                            ? "text-slate-500"
                            : "text-amber-300"
                      }
                    >
                      {knockStatus(p)}
                    </span>
                  )}
                  <span>{p.handCount} cards</span>
                  <span>{p.tricksWon} tricks</span>
                  <span>{p.money}¢</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Your hand */}
      <div className="rounded-xl bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-semibold">
          Your hand
          {iAmBlind && (
            <span className="ml-2 text-xs font-normal text-amber-300">
              (dealer is blind until the discard phase)
            </span>
          )}
        </h2>
        <div className="flex gap-2">
          {(me?.hand ?? []).map((card: CardSlot, i) => (
            <Card
              key={i}
              card={card}
              highlight={
                !!card &&
                !!state.trumpCard &&
                card.suit === state.trumpCard.suit &&
                card.rank === state.trumpCard.rank
              }
            />
          ))}
        </div>
      </div>

      {/* Dealer trump decision */}
      {iAmDealer && state.roundState === "trump-selection" && (
        <div className="rounded-xl bg-slate-800 p-4">
          <p className="mb-3 text-sm">
            You're the dealer. The trump is{" "}
            <span className="font-semibold text-amber-300">
              {state.trumpCard?.rank}
              {state.trumpCard?.suit}
            </span>
            . Keep it (joins your hand, can't be discarded) or pass?
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => keepTrump(true)}
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium hover:bg-emerald-400"
            >
              Keep trump
            </button>
            <button
              onClick={() => keepTrump(false)}
              className="flex-1 rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-500"
            >
              Pass
            </button>
          </div>
        </div>
      )}

      {/* Knock-in decision */}
      {myTurnToKnock && (
        <div className="rounded-xl bg-slate-800 p-4">
          <p className="mb-3 text-sm">
            Knock in to play this hand (you commit your ante), or pass to fold?
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => knock(true)}
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium hover:bg-emerald-400"
            >
              Knock in
            </button>
            <button
              onClick={() => knock(false)}
              className="flex-1 rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-500"
            >
              Pass
            </button>
          </div>
        </div>
      )}

      {/* End of hand */}
      {state.roundState === "end" && (
        <div className="rounded-xl bg-slate-800 p-4 text-center">
          <p className="text-sm font-semibold text-amber-300">Hand complete</p>
          <p className="mt-1 text-xs text-slate-400">
            Pot was {state.potValue}¢.
          </p>
          {isHost ? (
            <button
              onClick={nextHand}
              className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400"
            >
              Deal next hand
            </button>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Waiting for the host to deal the next hand…
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
