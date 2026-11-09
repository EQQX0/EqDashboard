#!/data/data/com.termux/files/usr/bin/bash
# SUPERSEDED: use start-all.example.sh. Two boot scripts that both start node/cloudflared will conflict.
# Started by Termux:Boot. Keeps the CPU awake and launches the agent.
termux-wake-lock
cd ~/s21-server/agent
nohup node server.js >> ~/s21-server/agent.log 2>&1 &
nohup cloudflared tunnel run s21 >> ~/s21-server/tunnel.log 2>&1 &
