#!/data/data/com.termux/files/usr/bin/sh
# Example boot script: Samsung server agent + tunnel (+ your other apps). Copy to ~/.termux/boot/start-all.sh and chmod +x.
# Needs the Termux:Boot app opened once. Only ONE script in ~/.termux/boot should start node/cloudflared.
termux-wake-lock
# Stop only our own processes. Node apps are matched by working folder, never by name alone.
stop_node_in() { for p in $(pgrep -f "node server.js"); do [ "$(readlink /proc/$p/cwd)" = "$1" ] && kill $p; done; }
stop_node_in "$HOME/samsung-server/agent"
pkill cloudflared 2>/dev/null
sleep 2
(cd ~/samsung-server/agent && nohup node server.js >> ~/samsung-server/agent.log 2>&1 &)
CFG="$HOME/.cloudflared/config.yml"; TID=$(sed -n 's/^tunnel:[[:space:]]*//p' "$CFG" | tr -d "\"' \r")
nohup cloudflared tunnel --config "$CFG" run $TID >> ~/cloudflared.log 2>&1 &
# Add your other services below, each started in a subshell with its own folder, e.g.:
# (cd ~/gym/api && set -a && . ~/gym/.env && set +a && nohup node server.js >> ~/gym/api.log 2>&1 &)
