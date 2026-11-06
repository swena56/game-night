from .backgammon import Backgammon
from .base import Game, GameError
from .billiards import Billiards
from .boxes import Boxes
from .checkers import Checkers
from .cribbage import Cribbage
from .doodle import Doodle
from .farkle import Farkle
from .chess import Chess
from .dropfour import DropFour
from .fibfinder import FibFinder
from .go import Go
from .hearts import Hearts
from .gridhunt import GridHunt
from .hedgerow import Hedgerow
from .heist import Heist
from .hockey import Hockey
from .holdem import Holdem
from .ladder import Ladder
from .lastcard import LastCard
from .liars import LiarsDice
from .lucky import Lucky
from .morris import Morris
from .moonshot import MoonShot
from .oddone import OddOne
from .oware import Oware
from .paintblast import PaintBlast
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

# Order here is the order of the lobby's game picker.
GAMES = {g.id: g for g in (Unmask, OddOne, Relay, Trivia, Doodle, Lucky, Spire, Riders, PaintBlast, Sumo, Putt, Rally, Hockey, Billiards, Wordsmith, GridHunt, Safecracker, FibFinder, Ladder, Chess, Checkers, Backgammon, Go, Oware, Reversi, Hedgerow, LastCard, Holdem, Cribbage, Hearts, Speed, Rummy, SeaBattle,
                           DropFour, Boxes, TicTacToe, Ultimate, Morris, Heist, MoonShot, Yacht, Farkle, Qork, ShipCrew, ShutBox, LiarsDice, TwentyOne)}
GAME_INFO = [g.info() for g in GAMES.values()]

__all__ = ["GAMES", "GAME_INFO", "Game", "GameError"]
