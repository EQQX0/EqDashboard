#!/data/data/com.termux/files/usr/bin/bash
# Only for a brand-new tunnel. If tunnel "s21" already exists, do NOT run this: it will not overwrite config.yml. Add the hostname to ~/.cloudflared/config.yml and run `cloudflared tunnel route dns s21 <host>` instead.
# Run once in Termux: bash tunnel-setup.sh yourdomain.com
# Creates a Cloudflare tunnel and routes api.<domain> to the agent. Your main site is not touched.
set -e
DOMAIN="${1:-$DOMAIN}"
if [ -z "$DOMAIN" ]; then echo "Usage: bash tunnel-setup.sh yourdomain.com"; exit 1; fi
NAME=s21

cloudflared tunnel login            # opens a URL: authorize it for your domain in a browser
# A tunnel with this name from an earlier setup can exist in Cloudflare while its key file is gone from this phone
# (after a reinstall). Nothing can use it then, so replace it. A tunnel whose key is still here is left alone.
if cloudflared tunnel list -o json 2>/dev/null | grep -q "\"name\": *\"$NAME\""; then
  OLD=$(cloudflared tunnel list -o json | tr '{' '
'
' | grep "\"name\": *\"$NAME\"" | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$OLD" ] && [ -f "$HOME/.cloudflared/$OLD.json" ]; then
    echo "Tunnel $NAME already exists with its key on this phone. Not touching it."; exit 1
  fi
  echo "Replacing the old $NAME tunnel (its key is not on this phone)"
  cloudflared tunnel delete -f "$NAME"
fi
cloudflared tunnel create "$NAME"   # prints the tunnel ID and writes its credentials file

ID=$(cloudflared tunnel list -o json | tr '{' '
'
' | grep "\"name\": *\"$NAME\"" | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: api.$DOMAIN
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF

cloudflared tunnel route dns --overwrite-dns "$NAME" api.$DOMAIN

echo "Test: cloudflared tunnel run $NAME"
echo "Then: curl -H 'Authorization: Bearer <token>' https://api.$DOMAIN/status"
