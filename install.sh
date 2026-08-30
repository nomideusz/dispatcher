#!/bin/sh

set -eu

repository="https://github.com/ThallesP/dispatcher"
version="${DISPATCHER_VERSION:-latest}"

fail() {
	printf 'dispatcherctl installer: %s\n' "$1" >&2
	exit 1
}

download() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$1" -o "$2"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$2" "$1"
	else
		fail "curl or wget is required"
	fi
}

case "$version" in
	*[!A-Za-z0-9._-]*) fail "invalid DISPATCHER_VERSION" ;;
esac

case "$(uname -s)" in
	Linux) os="linux" ;;
	Darwin) os="darwin" ;;
	*) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
	x86_64 | amd64) arch="amd64" ;;
	arm64 | aarch64) arch="arm64" ;;
	*) fail "unsupported architecture: $(uname -m)" ;;
esac

if [ -n "${DISPATCHER_INSTALL_DIR:-}" ]; then
	install_dir="$DISPATCHER_INSTALL_DIR"
elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
	install_dir="/usr/local/bin"
elif [ -n "${HOME:-}" ]; then
	install_dir="$HOME/.local/bin"
else
	fail "set DISPATCHER_INSTALL_DIR to choose an installation directory"
fi

archive="dispatcherctl_${os}_${arch}.tar.gz"
if [ "$version" = "latest" ]; then
	release_url="$repository/releases/latest/download"
else
	release_url="$repository/releases/download/$version"
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

printf 'Downloading dispatcherctl %s for %s/%s...\n' "$version" "$os" "$arch"
download "$release_url/$archive" "$temp_dir/$archive" || fail "could not download $archive"
download "$release_url/checksums.txt" "$temp_dir/checksums.txt" || fail "could not download checksums.txt"

expected="$(awk -v archive="$archive" '$2 == archive { print $1; exit }' "$temp_dir/checksums.txt")"
[ -n "$expected" ] || fail "release checksum for $archive was not found"

if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$temp_dir/$archive" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
	actual="$(shasum -a 256 "$temp_dir/$archive" | awk '{ print $1 }')"
else
	fail "sha256sum or shasum is required to verify the download"
fi
[ "$actual" = "$expected" ] || fail "checksum verification failed"

tar -xzf "$temp_dir/$archive" -C "$temp_dir" dispatcherctl
mkdir -p "$install_dir"
install -m 0755 "$temp_dir/dispatcherctl" "$install_dir/dispatcherctl"

printf 'Installed dispatcherctl to %s/dispatcherctl\n' "$install_dir"
case ":${PATH:-}:" in
	*":$install_dir:"*) ;;
	*) printf 'Add %s to PATH to run dispatcherctl directly.\n' "$install_dir" ;;
esac
