"""Playlist validation, persistence and progression through the normal room actions."""
import pickle
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def act(room, player, kind, **extra):
    return server.do_action({"code": room.code, "pid": player.id, "token": player.token,
                             "type": kind, **extra})


def request(room):
    return {"gameNo": room.game_no, "index": room.playlist_index, "revision": room.playlist_revision}


def reject(message, room, player, kind, **extra):
    try:
        act(room, player, kind, **extra)
    except server.GameError as e:
        assert message in str(e), str(e)
    else:
        raise AssertionError(f"{kind} should have failed")


def finish_tictactoe(room):
    for cell in (0, 3, 1, 4, 2):
        act(room, room.players[room.turn], "move", cell=cell)
    assert room.phase == "over"


def test_playlist():
    room = server.Room("TEST")
    server.ROOMS[room.code] = room
    host = room.add_player("Host")
    guest = room.add_player("Guest")
    observer = room.add_player("Observer")
    observer.spectator = True

    # Older serialized state has none of the playlist fields.
    old_state = pickle.loads(pickle.dumps(room.__getstate__()))
    for field in ("playlist", "playlist_index", "playlist_revision"):
        del old_state[field]
    old_room = server.Room.__new__(server.Room)
    old_room.__setstate__(old_state)
    assert old_room.view(host)["playlist"] is None
    old_room.host_start(host, "lobby")
    assert old_room.phase == "playing"

    act(room, host, "settings", settings={"game": "tictactoe"})
    act(room, host, "settings", settings={"lucky": False})
    act(room, host, "settings", settings={"game": "unmask", "mode": "duel"})
    lineup = ["tictactoe", "unmask", "tictactoe"]
    reject("Only the host", room, guest, "set_playlist", games=lineup, **request(room))
    reject("catalog", room, host, "set_playlist", games=[{}], **request(room))
    reject("catalog", room, host, "set_playlist", games=lineup * 3, **request(room))
    act(room, host, "set_playlist", games=lineup[:1], **request(room))
    reject("at least 2", room, host, "start_playlist", **request(room))
    initial = request(room)
    act(room, host, "set_playlist", games=lineup, **initial)
    reject("playlist has changed", room, host, "start_playlist", **initial)
    act(room, host, "set_playlist", games=["dropfour", "unmask"], **request(room))
    observer.spectator = False
    reject("Game 2", room, host, "start_playlist", **request(room))
    assert room.phase == "lobby" and room.game_no == 0 and room.game is None
    observer.spectator = True
    act(room, host, "set_playlist", games=lineup, **request(room))
    act(room, host, "start_playlist", **request(room))
    assert room.settings["lucky"] is False
    finish_tictactoe(room)
    assert host.points + guest.points == 4
    continuation = request(room)

    with tempfile.TemporaryDirectory() as tmp:
        server.SAVE_FILE = str(Path(tmp) / "rooms.pickle")
        server.save_rooms()
        server.ROOMS.clear()
        server.load_rooms()
    room = server.ROOMS["TEST"]
    host, guest, observer = (room.players[p.id] for p in (host, guest, observer))
    assert request(room) == continuation
    assert room.view(host)["playlist"] == {"games": lineup, "index": 0, "blocked": None}
    assert room.view(guest)["hasReplay"]
    reject("Only the host", room, guest, "next_playlist", **continuation)
    reject("playlist sets", room, host, "rematch")
    reject("playlist sets", room, guest, "next_vote", game="tictactoe")
    reject("playlist sets", room, host, "play_vote")
    # Use an independent copy to advance the restored room and race a retried request.
    resumed = pickle.loads(pickle.dumps(room))
    server.ROOMS[room.code] = resumed
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(
            lambda _: act(resumed, host, "next_playlist", aid="same-request", **continuation),
            range(2),
        ))
    assert sum(reply.get("repeat", False) for reply in replies) == 1
    assert resumed.game_no == 2 and resumed.settings["game"] == "unmask"
    reject("Not right now", resumed, host, "next_playlist", **continuation)
    server.ROOMS[room.code] = room

    act(room, guest, "leave")
    assert "Duel needs exactly 2" in room.view(host)["playlist"]["blocked"]
    reject("Duel needs exactly 2", room, host, "next_playlist", **continuation)
    assert request(room) == continuation and room.phase == "over"
    assert len(room.history) == 1 and room.settings["game"] == "tictactoe"
    assert room.view(host)["hasReplay"]
    act(room, host, "lobby", **continuation)
    assert room.phase == "lobby" and not room.playlist and len(room.history) == 1
    assert room.ledger["guest"]["points"] + host.points == 4

    # Start another playlist with the observer and stop it during play.
    assert observer in room.seated()
    act(room, host, "set_playlist", games=lineup, **request(room))
    act(room, host, "start_playlist", **request(room))
    act(room, host, "end_game")
    assert room.phase == "lobby" and not room.playlist and room.playlist_index is None
    assert len(room.history) == 1


if __name__ == "__main__":
    test_playlist()
    print("Playlist rule checks passed")
