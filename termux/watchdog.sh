#!/data/data/com.termux/files/usr/bin/sh
# Keeps the Samsung server agent and the Cloudflare tunnel alive. Run every minute from cron:
#   * * * * * sh $HOME/s21-server/termux/watchdog.sh
# Only touches the Samsung server agent (matched by working folder) and cloudflared.
# Your other apps (gym, eq, nginx) are not started or stopped here.
AGENT_DIR="$HOME/s21-server/agent"
LOG="$HOME/s21-server/watchdog.log"
PORT="${PORT:-8787}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Keep the log small (last ~200 lines).
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 400 ]; then tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

# Agent: alive if it answers on localhost (401 without a token is a healthy answer).
code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/status" 2>/dev/null)
case "$code" in
  200|401) ;;
  *)
    log "agent not answering (http=$code), restarting"
    for p in $(pgrep -f "node server.js"); do
      [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$AGENT_DIR" ] && kill "$p"
    done
    sleep 1
    (cd "$AGENT_DIR" && nohup node server.js >> "$HOME/s21-server/agent.log" 2>&1 &)
    ;;
esac

# Tunnel: restart only if no cloudflared process exists.
if ! pgrep -x cloudflared >/dev/null 2>&1; then
  log "cloudflared not running, restarting"
  nohup cloudflared tunnel run s21 >> "$HOME/cloudflared.log" 2>&1 &
fi
