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
from .gridhunt import GridHunt
from .heist import Heist
from .hockey import Hockey
from .holdem import Holdem
from .lastcard import LastCard
from .lucky import Lucky
from .moonshot import MoonShot
from .oddone import OddOne
from .paintblast import PaintBlast
from .relay import Relay
from .riders import Riders
from .safecracker import Safecracker
from .seabattle import SeaBattle
from .spire import Spire
from .sumo import Sumo
from .tictactoe import TicTacToe
from .unmask import Unmask
from .yacht import Yacht
from .wordsmith import Wordsmith

# Order here is the order of the lobby's game picker.
GAMES = {g.id: g for g in (Unmask, OddOne, Relay, FibFinder, Doodle, Lucky, Spire, Riders, PaintBlast, Sumo, Hockey, Billiards, Wordsmith, GridHunt, Safecracker, Chess, Checkers, Backgammon, Go, LastCard, Holdem, Cribbage, SeaBattle,
                           DropFour, Boxes, TicTacToe, Heist, MoonShot, Yacht, Farkle)}
GAME_INFO = [g.info() for g in GAMES.values()]

__all__ = ["GAMES", "GAME_INFO", "Game", "GameError"]
