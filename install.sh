#!/bin/sh
# Install the latest Stable Ruru on Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/kerwincarpede/ruru/main/install.sh | sh
#
# Picks the .deb on Debian and Ubuntu, the .rpm on Fedora and openSUSE, and the
# AppImage everywhere else. Set RURU_FORMAT=deb, rpm or appimage to choose one,
# and RURU_VERSION=0.1.2 to install a specific release.

set -eu

REPO="kerwincarpede/ruru"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(uname -s)" = "Linux" ] || fail "this script installs Ruru on Linux only. Download your installer from https://github.com/$REPO/releases/latest."

case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  aarch64 | arm64) arch=aarch64 ;;
  *) fail "unsupported CPU: $(uname -m). Ruru ships for x86_64 and arm64." ;;
esac

if have curl; then
  fetch() { curl -fsSL "$1"; }
  download() { curl -fL --progress-bar -o "$2" "$1"; }
elif have wget; then
  fetch() { wget -qO- "$1"; }
  download() { wget -q --show-progress -O "$2" "$1"; }
else
  fail "curl or wget is required."
fi

# Run a command as root, using sudo when we are not root already.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    fail "run this as root or install sudo."
  fi
}

format="${RURU_FORMAT:-}"
if [ -z "$format" ]; then
  if have apt-get && have dpkg; then
    format=deb
  elif have dnf || have zypper; then
    format=rpm
  else
    format=appimage
  fi
fi

case "$format" in
  deb | rpm | appimage) ;;
  *) fail "RURU_FORMAT must be deb, rpm or appimage." ;;
esac

if [ -n "${RURU_VERSION:-}" ]; then
  release_url="https://api.github.com/repos/$REPO/releases/tags/v${RURU_VERSION#v}"
else
  # /releases/latest is the newest Stable release; Edge builds are pre-releases.
  release_url="https://api.github.com/repos/$REPO/releases/latest"
fi

say "Finding the release..."
urls=$(fetch "$release_url" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/') ||
  fail "could not read the release from GitHub."

case "$format-$arch" in
  deb-x86_64) pattern='_amd64\.deb$' ;;
  deb-aarch64) pattern='_arm64\.deb$' ;;
  rpm-x86_64) pattern='\.x86_64\.rpm$' ;;
  rpm-aarch64) pattern='\.aarch64\.rpm$' ;;
  appimage-x86_64) pattern='_amd64\.AppImage$' ;;
  appimage-aarch64) pattern='_aarch64\.AppImage$' ;;
esac

url=$(printf '%s\n' "$urls" | grep "$pattern" | head -n 1 || true)
[ -n "$url" ] || fail "no $format installer for $arch in that release."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
file="$tmp/$(basename "$url")"

say "Downloading $(basename "$url")..."
download "$url" "$file"

case "$format" in
  deb)
    say "Installing with apt (you may be asked for your password)..."
    as_root apt-get install -y "$file"
    ;;
  rpm)
    say "Installing the package (you may be asked for your password)..."
    if have dnf; then
      as_root dnf install -y "$file"
    else
      as_root zypper --non-interactive --no-gpg-checks install "$file"
    fi
    ;;
  appimage)
    bin_dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
    app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    mkdir -p "$bin_dir" "$app_dir"
    cp "$file" "$bin_dir/ruru.AppImage"
    chmod +x "$bin_dir/ruru.AppImage"
    cat >"$app_dir/ruru.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Ruru
Comment=A camera wall for Frigate
Exec=$bin_dir/ruru.AppImage
Terminal=false
Categories=AudioVideo;Video;
EOF
    say "Installed to $bin_dir/ruru.AppImage."
    case ":$PATH:" in
      *":$bin_dir:"*) ;;
      *) say "Add $bin_dir to your PATH to run it as 'ruru.AppImage'." ;;
    esac
    if ! have fusermount && ! have fusermount3; then
      say "AppImages need FUSE. On Ubuntu run: sudo apt install libfuse2t64 (or libfuse2 on 22.04 and earlier)."
    fi
    ;;
esac

say "Ruru is installed. Open it from your app menu."
