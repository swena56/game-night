#!/data/data/com.termux/files/usr/bin/env bash
# Game Night server control.
#   ./start.sh            start in the background (same as "start")
#   ./start.sh stop | restart | status | log
# The server keeps running after you close Termux's session or Claude Code. Output goes to
# data/server.log. Set PORT=9000 (etc.) in the environment to use another port.
set -u
cd "$(dirname "$(readlink -f "$0")")"   # works from anywhere, and after the folder is renamed
PIDFILE=data/server.pid
LOG=data/server.log
PORT=${PORT:-8000}
mkdir -p data

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

start() {
  if running; then echo "Already running (pid $(cat "$PIDFILE")) → http://localhost:$PORT"; return 0; fi
  # Android pauses Termux when the screen is off unless it holds a wake lock (needs Termux:API).
  command -v termux-wake-lock >/dev/null && termux-wake-lock
  # nohup + its own session (setsid) so closing the terminal or Claude Code doesn't stop it
  PORT=$PORT $(command -v setsid) nohup python3 -u server.py >> "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -s -o /dev/null "http://localhost:$PORT/"; then
      echo "Game Night is running (pid $(cat "$PIDFILE")). Log: $LOG"
      grep "friends:" "$LOG" | tail -1
      return 0
    fi
    running || break
    sleep 0.5
  done
  echo "The server didn't come up. Last lines of $LOG:"; tail -15 "$LOG"; return 1
}

stop() {
  if ! running; then echo "Not running."; rm -f "$PIDFILE"; return 0; fi
  kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE" && echo "Stopped. (Rooms are saved and come back on the next start.)"
  command -v termux-wake-unlock >/dev/null && termux-wake-unlock
  return 0
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) if running; then echo "Running (pid $(cat "$PIDFILE")) → http://localhost:$PORT"; else echo "Not running."; fi ;;
  log) tail -n 40 -f "$LOG" ;;
  *) echo "Usage: $0 [start|stop|restart|status|log]"; exit 2 ;;
esac
