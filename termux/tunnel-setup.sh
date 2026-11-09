#!/data/data/com.termux/files/usr/bin/bash
# Run once in Termux: bash tunnel-setup.sh yourdomain.com
# Creates a Cloudflare tunnel named "samsung-server" and routes api.<domain> to the agent. Your main site is not touched.
# If a tunnel named "samsung-server" already works on this phone (its key file is here), this script leaves it alone:
# add a hostname to ~/.cloudflared/config.yml and run `cloudflared tunnel route dns samsung-server <host>` instead.
set -e
DOMAIN="${1:-$DOMAIN}"
if [ -z "$DOMAIN" ]; then echo "Usage: bash tunnel-setup.sh yourdomain.com"; exit 1; fi
NAME=samsung-server

# Prints the id of the tunnel called $NAME, or nothing. Tries the list first, then asks about the tunnel by name.
tunnel_id() {
  local id
  id=$(cloudflared tunnel list -o json 2>/dev/null | tr '{' '
' | grep "\"name\": *\"$NAME\"" | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$id" ]; then
    id=$(cloudflared tunnel info "$NAME" 2>/dev/null | grep -Eio '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  fi
  echo "$id"
}

cloudflared tunnel login            # opens a URL: authorize it for your domain in a browser

# Make the tunnel. If the name is taken by a tunnel from an earlier setup whose key file is not on this phone
# (after a reinstall), nothing can use it, so delete it and make a new one. If its key IS here, leave it alone.
if ! cloudflared tunnel create "$NAME"; then
  OLD=$(tunnel_id)
  if [ -n "$OLD" ] && [ -f "$HOME/.cloudflared/$OLD.json" ]; then
    echo "Tunnel $NAME already exists with its key on this phone. Not touching it."; exit 1
  fi
  echo "Replacing the old $NAME tunnel (its key is not on this phone)"
  cloudflared tunnel delete -f "$NAME"
  cloudflared tunnel create "$NAME"
fi

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
