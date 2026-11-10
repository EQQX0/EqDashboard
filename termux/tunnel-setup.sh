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

# login refuses to run when cert.pem exists (and set -e would abort), so only log in when it is missing
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  cloudflared tunnel login            # opens a URL: authorize it for your domain in a browser
fi

# Reuse the tunnel if it already exists and its key file is on this phone.
ID=$(tunnel_id)
if [ -n "$ID" ] && [ -f "$HOME/.cloudflared/$ID.json" ]; then
  echo "Tunnel $NAME already exists with its key on this phone. Reusing it ($ID)."
else
  # If the name is taken by a tunnel from an earlier setup whose key file is not on this phone
  # (after a reinstall), nothing can use it, so delete it and make a new one.
  if ! cloudflared tunnel create "$NAME"; then
    OLD=$(tunnel_id)
    if [ -n "$OLD" ] && [ -f "$HOME/.cloudflared/$OLD.json" ]; then
      echo "Tunnel $NAME already exists with its key on this phone. Reusing it."
    else
      echo "Replacing the old $NAME tunnel (its key is not on this phone)"
      cloudflared tunnel delete -f "$NAME"
      cloudflared tunnel create "$NAME"
    fi
  fi
  ID=$(tunnel_id)
fi

mkdir -p ~/.cloudflared
if [ ! -f ~/.cloudflared/config.yml ]; then
cat > ~/.cloudflared/config.yml <<EOF
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: api.$DOMAIN
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF
else
  echo "Keeping existing ~/.cloudflared/config.yml"
fi

DOCTOR="$HOME/samsung-server/agent/tunnel-doctor.js"
if [ -f "$DOCTOR" ]; then
  node "$DOCTOR" --domain "$DOMAIN" --fix-ingress --route || echo "tunnel-doctor found problems (see FIX: lines above); continuing"
else
  # --overwrite-dns replaces an old api.<domain> record left from an earlier tunnel
  cloudflared tunnel route dns --overwrite-dns "$NAME" api.$DOMAIN
fi

echo "Test: cloudflared tunnel --config ~/.cloudflared/config.yml run $ID"
echo "Then: curl -H 'Authorization: Bearer <token>' https://api.$DOMAIN/status"
