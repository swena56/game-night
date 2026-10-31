"""Shared bot search for two-player, perfect-information games (Oware, Reversi, Ultimate Tic-Tac-Toe,
Nine Men's Morris): negamax with alpha-beta pruning and iterative deepening under a time budget.

A game supplies three functions over its own immutable state:
  moves(state, me)        legal moves for player `me` (0/1); [] means the game is over
  play(state, me, move)   the new state after `me` plays `move` (the other player moves next)
  evaluate(state, me)     a score from `me`'s point of view; it must also score finished games
                          (use +/- WIN for wins, so quicker wins can be preferred)"""
import time

WIN = 10 ** 6
INF = float("inf")


class _Timeout(Exception):
    pass


def best_move(state, me, moves, play, evaluate, depth, budget, rng, noise=0.0):
    """The best move found within `depth` plies or `budget` seconds. `noise` adds a random amount
    (in evaluation units) to each root score so weaker bots vary their play."""
    deadline = time.time() + budget
    root = moves(state, me)
    if not root:
        return None
    if len(root) == 1:
        return root[0]
    root = rng.sample(root, len(root))  # equal moves come out in a different order each game
    best = root[0]

    def negamax(st, pl, d, alpha, beta):
        if time.time() > deadline:
            raise _Timeout
        ms = moves(st, pl)
        if d == 0 or not ms:
            return evaluate(st, pl) * (1 + d * 1e-4)  # a win found sooner scores a hair higher
        val = -INF
        for m in ms:
            val = max(val, -negamax(play(st, pl, m), 1 - pl, d - 1, -beta, -alpha))
            alpha = max(alpha, val)
            if alpha >= beta:
                break
        return val

    for d in range(1, depth + 1):
        try:
            scored = []
            alpha = -INF
            for m in root:
                v = -negamax(play(state, me, m), 1 - me, d - 1, -INF, -alpha)
                scored.append((v + rng.uniform(0, noise), m))
                alpha = max(alpha, v)
        except _Timeout:
            break
        top = max(v for v, _ in scored)
        best = next(m for v, m in scored if v == top)  # the first holds the exact score; later ties were cut off
        root = [m for _, m in sorted(scored, key=lambda vm: -vm[0])]  # best first next time
    return best
