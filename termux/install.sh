#!/data/data/com.termux/files/usr/bin/bash
# One-command install for the Samsung server, run inside Termux:
#   curl -fsSL https://raw.githubusercontent.com/EQQX0/EqDashboard/main/termux/install.sh | bash -s -- yourdomain.com
# The domain is optional. Without it the agent still runs on the phone; add the tunnel later with termux/tunnel-setup.sh.
# Safe to run again: it updates the code and never overwrites your token, tunnel or boot script.
set -e
DOMAIN="${1:-$DOMAIN}"
REPO="${REPO:-https://github.com/EQQX0/EqDashboard.git}"
DIR="$HOME/s21-server"

echo "==> Installing git"
pkg install -y git curl

echo "==> Getting the code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only || echo "Could not update the code, continuing with what is here."
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  echo "$DIR already exists and is not a git folder. Move it away and run this again."; exit 1
else
  git clone "$REPO" "$DIR"
fi

echo "==> Installing packages (a few minutes)"
bash "$DIR/termux/setup.sh"

if [ -n "$DOMAIN" ]; then
  if [ -f "$HOME/.cloudflared/config.yml" ]; then
    echo "==> Tunnel config already exists, leaving it alone"
  else
    echo "==> Connecting $DOMAIN: open the link below in a browser and approve it"
    bash "$DIR/termux/tunnel-setup.sh" "$DOMAIN"
  fi
fi

echo "==> Starting on boot"
mkdir -p "$HOME/.termux/boot"
if [ -z "$(ls -A "$HOME/.termux/boot" 2>/dev/null)" ]; then
  cp "$DIR/termux/start-all.example.sh" "$HOME/.termux/boot/start-all.sh"
  chmod +x "$HOME/.termux/boot/start-all.sh"
  START="$HOME/.termux/boot/start-all.sh"
else
  echo "You already have a boot script, so I left it. Make sure it starts the agent."
  START="$DIR/termux/start-all.example.sh"
fi

echo "==> Starting the agent now"
sh "$START"
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$DIR/agent/.token" ] && break; sleep 1; done

echo
echo "Done."
if [ -s "$DIR/agent/.token" ]; then
  echo "Token (paste it into the app, keep it private):"
  cat "$DIR/agent/.token"; echo
else
  echo "The agent did not start. Look at: tail ~/s21-server/agent.log"
fi
[ -n "$DOMAIN" ] && echo "Server address for the app: https://api.$DOMAIN"
echo
echo "Two things left on the phone:"
echo " 1. Android settings > Apps > Termux > Battery > Unrestricted"
echo " 2. Open the Termux:Boot app once (install it from F-Droid) so it starts after a reboot"
