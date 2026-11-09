#!/data/data/com.termux/files/usr/bin/bash
# One-command install for the Samsung server, run inside Termux:
#   curl -fsSL https://raw.githubusercontent.com/EQQX0/EqDashboard/main/termux/install.sh | bash -s -- yourdomain.com
# The domain is optional. Without it the agent still runs on the phone; add the tunnel later with termux/tunnel-setup.sh.
# Safe to run again: it updates the code and never overwrites your token, tunnel or boot script.
set -e
DOMAIN="${1:-$DOMAIN}"
REPO="${REPO:-https://github.com/EQQX0/EqDashboard.git}"
DIR="$HOME/samsung-server"

if [ "$DOMAIN" = "yourdomain.com" ]; then
  echo "Replace yourdomain.com with your real domain (or leave it off), then run it again."; exit 1
fi

# Termux is upgraded as a whole with apt-get, which works even when curl or git are half-updated and broken.
echo "==> Updating Termux first (a half-updated Termux breaks git and curl)"
export DEBIAN_FRONTEND=noninteractive
APT_OPTS="-y -o Dpkg::Options::=--force-confnew"
apt-get update -y
apt-get full-upgrade $APT_OPTS
echo "==> Installing git"
apt-get install $APT_OPTS git curl

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
  echo "The agent did not start. Look at: tail ~/samsung-server/agent.log"
fi
if [ -n "$DOMAIN" ]; then
  echo "Server address for the app: https://api.$DOMAIN"
  # A pairing file holds the address and token, so signing in is "pick this file" instead of typing.
  if [ -s "$DIR/agent/.token" ]; then
    if [ ! -d "$HOME/storage/downloads" ]; then
      termux-setup-storage 2>/dev/null || true   # Android asks for permission; tap Allow
      for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -d "$HOME/storage/downloads" ] && break; sleep 1; done
    fi
    if [ -d "$HOME/storage/downloads" ]; then
      PAIR="$HOME/storage/downloads/samsung-server.pair"; WHERE="it is in your Downloads folder"
    else
      PAIR="$HOME/samsung-server.pair"; WHERE="storage access was not allowed, so it is only in Termux: run termux-setup-storage, allow it, then rerun this installer to put it in Downloads"
    fi
    if (cd "$DIR/agent" && node pair.js --url "https://api.$DOMAIN" --out "$PAIR" --force >/dev/null); then
      echo
      echo "Pairing file: $PAIR"
      echo " - Phone app: tap 'Import token file' on the sign-in screen and pick it ($WHERE)."
      echo " - Windows app: put the file in Downloads or Desktop and the app signs in by itself."
      echo " - Send it to another device: termux-share $PAIR"
      echo " - It holds your token, and other apps can read your Downloads folder, so it deletes itself in 30 minutes."
      echo "   Delete it sooner with: rm $PAIR   (make a new one any time with: cd ~/samsung-server/agent && node pair.js --url https://api.$DOMAIN --out $PAIR --force)"
      nohup sh -c "sleep 1800; rm -f '$PAIR'" >/dev/null 2>&1 &
    fi
  fi
fi
echo
# Battery and temperature need the Termux:API Android app (the package is installed, the app is separate).
if ! timeout 8 termux-battery-status 2>/dev/null | grep -q percentage; then
  NOAPI=1
fi
echo "Left to do on the phone:"
echo " 1. Android settings > Apps > Termux > Battery > Unrestricted"
echo " 2. Open the Termux:Boot app once (install it from F-Droid) so it starts after a reboot"
if [ -n "$NOAPI" ]; then
  echo " 3. Install the Termux:API app from F-Droid and open it once, so Overview can show battery and temperature"
fi
