#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
GOOS="${GOOS:-$(go env GOOS)}"
GOARCH="${GOARCH:-$(go env GOARCH)}"
echo "Building StarBase Agent for ${GOOS}/${GOARCH}..."
go build -trimpath -ldflags "-s -w" -o "dist/starbase-agent-${GOOS}-${GOARCH}" ./cmd/starbase-agent
echo "Done: dist/starbase-agent-${GOOS}-${GOARCH}"