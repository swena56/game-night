from .backgammon import Backgammon
from .base import Game, GameError
from .midnight import Midnight
from .mia import Mia
from .squares import Squares
from .brawl import Brawl
from .derby import Derby
from .billiards import Billiards
from .cannon import Cannon
from .stones import Stones
from .archery import Archery
from .lanes import Lanes
from .wobble import Wobble
from .drift import Drift
from .snowball import Snowball
from .rapids import Rapids
from .midway import Midway
from .planes import Planes
from .orbit import Orbit
from .pond import Pond
from .domino import Domino
from .regatta import Regatta
from .tops import Tops
from .lander import Lander
from .pusher import Pusher
from .tide import Tide
from .boxes import Boxes
from .checkers import Checkers
from .cribbage import Cribbage
from .bingo import Bingo
from .doodle import Doodle
from .farkle import Farkle
from .chess import Chess
from .dropfour import DropFour
from .fibfinder import FibFinder
from .freecell import FreeCell
from .sudoku import Sudoku
from .wordsearch import WordSearch
from .garden import Garden
from .go import Go
from .hearts import Hearts
from .piquet import Piquet
from .skat import Skat
from .truc import Truc
from .bridge import Bridge
from .bezique import Bezique
from .pinochle import Pinochle
from .belote import Belote
from .mao import Mao
from .eleusis import Eleusis
from .canasta import Canasta
from .fivehundred import FiveHundred
from .ecarte import Ecarte
from .pitch import Pitch
from .sixtysix import SixtySix
from .ninetynine import NinetyNine
from .war import War
from .spite import Spite
from .cassino import Cassino
from .oldmaid import OldMaid
from .gofish import GoFish
from .bigtwo import BigTwo
from .ranter import Ranter
from .blitz import Blitz
from .briscola import Briscola
from .whist import Whist
from .nertz import Nertz
from .ratscrew import Ratscrew
from .palace import Palace
from .fantan import FanTan
from .germanwhist import GermanWhist
from .gin import Gin
from .scopa import Scopa
from .gops import Gops
from .euchre import Euchre
from .ohhell import OhHell
from .spades import Spades
from .kowhist import KnockOutWhist
from .spoons import Spoons
from .president import President
from .cheat import Cheat
from .gridhunt import GridHunt
from .hedgerow import Hedgerow
from .realm import Realm
from .heist import Heist
from .hockey import Hockey
from .klondike import Klondike
from .holdem import Holdem
from .ladder import Ladder
from .lantern import Lantern
from .lastcard import LastCard
from .liars import LiarsDice
from .lucky import Lucky
from .marble import Marble
from .morris import Morris
from .moonshot import MoonShot
from .oddone import OddOne
from .oware import Oware
from .paintblast import PaintBlast
from .prism import Prism
from .putt import Putt
from .qork import Qork
from .rally import Rally
from .relay import Relay
from .reversi import Reversi
from .riders import Riders
from .rummy import Rummy
from .safecracker import Safecracker
from .seabattle import SeaBattle
from .spire import Spire
from .sumo import Sumo
from .tictactoe import TicTacToe
from .shipcrew import ShipCrew
from .shutbox import ShutBox
from .speed import Speed
from .trivia import Trivia
from .twentyone import TwentyOne
from .ultimate import Ultimate
from .unmask import Unmask
from .yacht import Yacht
from .wordsmith import Wordsmith
from .wordbomb import WordBomb
from .whisker import Whisker
from .kindred import Kindred
from .meteorshot import MeteorShot
from .skydrop import SkyDrop
from .starguard import StarGuard

# Order here is the order of the lobby's game picker.
GAMES = {g.id: g for g in (Unmask, OddOne, Relay, Trivia, Doodle, Bingo, Pond, Domino, Lucky, Spire, Prism, Marble, Riders, Whisker, PaintBlast, Sumo, Putt, Rally, Hockey, Snowball, Rapids, Midway, Planes, Orbit, Regatta, Tops, Lander, Pusher, Tide, Billiards, Cannon, Stones, Archery, MeteorShot, Lanes, Wobble, Wordsmith, WordBomb, GridHunt, WordSearch, Garden, Safecracker, FibFinder, Ladder, Chess, Checkers, Backgammon, Go, Oware, Reversi, Hedgerow, Kindred, Realm, Drift, LastCard, Lantern, Holdem, Cribbage, Hearts, Speed, Rummy, Klondike, FreeCell, Cheat, President, Spoons, KnockOutWhist, Spades, OhHell, Euchre, Gops, Scopa, Gin, GermanWhist, FanTan, Palace, Ratscrew, Nertz, Whist, Briscola, Blitz, Ranter, BigTwo, GoFish, OldMaid, Cassino, Spite, War, NinetyNine, SixtySix, Pitch, Ecarte, FiveHundred, Canasta, Eleusis, Mao, Belote, Pinochle, Bezique, Bridge, Truc, Skat, Piquet, SeaBattle,
                           DropFour, Boxes, TicTacToe, Ultimate, Morris, Sudoku, Heist, MoonShot, Yacht, Farkle, Qork, ShipCrew, ShutBox, LiarsDice, Midnight, Mia, Squares, Brawl, Derby, TwentyOne, SkyDrop, StarGuard)}
# Subgroups for the two big categories (#98): the picker shows them as small headers, in this order.
FAMILIES = {
    "cards": [("Trick-taking", "hearts kowhist spades ohhell euchre germanwhist whist ninetynine pitch fivehundred bridge"),
              ("European classics", "briscola sixtysix ecarte belote pinochle bezique truc skat piquet scopa cassino"),
              ("Shedding & climbing", "lastcard cheat president fantan palace bigtwo mao eleusis"),
              ("Rummy & sets", "rummy gin canasta blitz cribbage"),
              ("Fast & family", "speed spoons nertz ratscrew war gofish oldmaid ranter"),
              ("Patience", "klondike freecell spite"),
              ("Bluff & bid", "holdem gops lantern")],
    "dice": [("Push your luck", "moonshot farkle midnight shipcrew brawl"),
             ("Score sheets", "yacht squares shutbox"),
             ("Bluff & bet", "liars mia qork derby twentyone")],
}
for _cat, _fams in FAMILIES.items():
    for _fam, _ids in _fams:
        for _id in _ids.split():
            assert GAMES[_id].category == _cat, _id
            GAMES[_id].family = _fam
GAME_INFO = [g.info() for g in GAMES.values()]
# the home screen's picker needs only this much of the catalogue (served at /api/games)
GAME_LIST = [{k: i[k] for k in ("id", "name", "icon", "blurb", "category", "family", "min", "max")} for i in GAME_INFO]

__all__ = ["GAMES", "GAME_INFO", "GAME_LIST", "FAMILIES", "Game", "GameError"]
