#!/data/data/com.termux/files/usr/bin/bash
# Run once inside Termux on the Samsung server.
set -e
pkg update -y
pkg install -y nodejs termux-api termux-services cloudflared aria2 ffmpeg python caddy proot-distro openssh
pip install yt-dlp

# Agent location
mkdir -p ~/samsung-server


echo "Done. Copy start-all.example.sh to ~/.termux/boot/start-all.sh (merge with your own boot script if you have one), chmod +x it, then run it."
echo "Then in Android settings: Termux > Battery > Unrestricted."
