"""Paint Blast Last Standing uses round survival to decide the match."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server
from games import paintblast as pb


def arena(players=2):
    room = server.Room("TEST")
    host = room.add_player("Ann")
    room.add_player("Bo")
    if players == 3:
        room.add_player("Cy")
    room.switch_game("paintblast")
    room.change_settings(host, {"mode": "last"})
    room.start()
    game = room.game
    game.frame(game.next_at)
    game.shield = [0] * players
    return game


def advance(game, now):
    with game.room.cond:
        return game.frame(now)


g = arena()
g.paint[:] = bytes([2]) * len(g.paint)
g.burn[g.pos[1]] = [pb.BURN, 1]
assert advance(g, g.last_frame + 2 / pb.TICK)
assert g.stage == "over" and g.total == [1, 0]
assert g.view(g.room.players[g.seats[1]])["paintblast"]["lastStanding"]
advance(g, g.next_at)
assert g.round == 2 and g.stun == [0, 0]
advance(g, g.next_at)
advance(g, g.ends_at)
advance(g, g.next_at)
assert g.room.phase == "over" and g.total == [1, 0]

g = arena(players=3)
g.burn[g.pos[1]] = [pb.BURN, 0]
advance(g, g.last_frame + 2 / pb.TICK)
for _ in range(pb.STUN):
    g.step()
assert g.stage == "play" and not g.active(1), "A knockout persists while others keep playing"

g = arena()
for pos in g.pos:
    g.burn[pos] = [pb.BURN, 0]
advance(g, g.last_frame + 2 / pb.TICK)
assert g.stage == "over" and g.total == [0, 0], "Simultaneous knockouts draw"

g = arena()
advance(g, g.ends_at)
assert g.stage == "over" and g.total == [0, 0], "Time with multiple survivors draws"

print("Last Standing: sole survivor, persistent and simultaneous knockouts, timeout, round reset and match scoring passed.")
