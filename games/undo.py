"""Take-back requests for two-player board games: ask to undo your last move, and it happens if your
opponent agrees (bots always do). Moving on declines a waiting request.

A game mixes in `Undo`, calls `self.snapshot(p)` just before applying p's move, routes actions through
`self.undo_act(p, t)`, adds `"undo": self.undo_view(p)` to its view, and implements:
    undo_state()          -> everything the move will change (copy mutable parts)
    undo_restore(state)   -> put that back
The room's turn is saved and restored here. The two newest moves are kept, so taking back your move also
takes back the reply that came after it. Go keeps its own version (it also tracks positions for ko)."""
from .base import GameError


class Undo:
    snaps, undo_ask = (), None  # class defaults: games saved before undo existed load without them

    def snapshot(self, p):
        self.undo_ask = None  # moving on counts as declining
        self.snaps = [*self.snaps, (p.id, self.undo_state(), self.room.turn)][-2:]

    def undo_act(self, p, t):
        """Handle an undo action; True if `t` was one."""
        if t == "undo_ask":
            self.ask_undo(p)
            return True
        if t in ("undo_yes", "undo_no"):
            if not self.undo_ask or self.undo_ask == p.id:
                raise GameError("There's no undo request to answer.")
            self.answer_undo(p, t == "undo_yes")
            return True
        return False

    def ask_undo(self, p):
        if self.room.phase != "playing" or not any(pid == p.id for pid, *_ in self.snaps):
            raise GameError("You have no move to take back.")
        if self.undo_ask:
            raise GameError("An undo request is already waiting.")
        self.undo_ask = p.id
        self.room.add_log(f"↶ {p.name} asks to take back their last move.", "power")
        opp = next((self.room.players.get(pid) for pid in self.seats if pid != p.id), None)
        if opp is None or opp.bot or opp.eliminated:
            self.answer_undo(opp, True)

    def answer_undo(self, p, accept):
        asker = self.room.players.get(self.undo_ask)
        self.undo_ask = None
        if not accept:
            return self.room.add_log(f"{p.name} said no to the undo.")
        turn = self.room.turn
        while self.snaps:
            pid, state, turn = self.snaps[-1]
            self.snaps = self.snaps[:-1]
            self.undo_restore(state)
            if asker is None or pid == asker.id:
                break
        self.room.add_log(f"↶ {asker.name if asker else '?'}'s move was taken back.", "power")
        self.room.begin_turn(turn)

    def undo_view(self, p):
        return {"asker": self.undo_ask, "can": any(pid == p.id for pid, *_ in self.snaps)}
