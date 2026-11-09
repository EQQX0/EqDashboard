#!/data/data/com.termux/files/usr/bin/bash
# Run once in Termux: bash tunnel-setup.sh yourdomain.com
# Creates a Cloudflare tunnel named "s21" and routes api.<domain> to the agent. Your main site is not touched.
# If a tunnel named "s21" already works on this phone (its key file is here), this script leaves it alone:
# add a hostname to ~/.cloudflared/config.yml and run `cloudflared tunnel route dns s21 <host>` instead.
set -e
DOMAIN="${1:-$DOMAIN}"
if [ -z "$DOMAIN" ]; then echo "Usage: bash tunnel-setup.sh yourdomain.com"; exit 1; fi
NAME=s21

# Prints the id of the tunnel called $NAME, or nothing.
tunnel_id() {
  cloudflared tunnel list -o json 2>/dev/null | tr '{' '\n' | grep "\"name\": *\"$NAME\"" | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4
}

cloudflared tunnel login            # opens a URL: authorize it for your domain in a browser

# A tunnel with this name from an earlier setup can exist in Cloudflare while its key file is gone from this phone
# (after a reinstall). Nothing can use it then, so replace it. A tunnel whose key is still here is left alone.
OLD=$(tunnel_id)
if [ -n "$OLD" ]; then
  if [ -f "$HOME/.cloudflared/$OLD.json" ]; then
    echo "Tunnel $NAME already exists with its key on this phone. Not touching it."; exit 1
  fi
  echo "Replacing the old $NAME tunnel (its key is not on this phone)"
  cloudflared tunnel delete -f "$NAME"
fi
cloudflared tunnel create "$NAME"   # prints the tunnel ID and writes its credentials file

ID=$(tunnel_id)
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: api.$DOMAIN
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF

# --overwrite-dns replaces an old api.<domain> record left from an earlier tunnel
cloudflared tunnel route dns --overwrite-dns "$NAME" api.$DOMAIN

echo "Test: cloudflared tunnel run $NAME"
echo "Then: curl -H 'Authorization: Bearer <token>' https://api.$DOMAIN/status"
