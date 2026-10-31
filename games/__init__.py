from .base import Game, GameError
from .billiards import Billiards
from .boxes import Boxes
from .checkers import Checkers
from .doodle import Doodle
from .chess import Chess
from .dropfour import DropFour
from .fibfinder import FibFinder
from .go import Go
from .heist import Heist
from .hockey import Hockey
from .holdem import Holdem
from .lastcard import LastCard
from .lucky import Lucky
from .moonshot import MoonShot
from .oddone import OddOne
from .relay import Relay
from .riders import Riders
from .seabattle import SeaBattle
from .spire import Spire
from .tictactoe import TicTacToe
from .unmask import Unmask
from .wordsmith import Wordsmith

# Order here is the order of the lobby's game picker.
GAMES = {g.id: g for g in (Unmask, OddOne, Relay, FibFinder, Doodle, Lucky, Spire, Riders, Hockey, Billiards, Wordsmith, Chess, Checkers, Go, LastCard, Holdem, SeaBattle,
                           DropFour, Boxes, TicTacToe, Heist, MoonShot)}
GAME_INFO = [g.info() for g in GAMES.values()]

__all__ = ["GAMES", "GAME_INFO", "Game", "GameError"]
