.PHONY: dev-api dev-web build build-cli install-cli run clean

CLI_VERSION ?= dev

# Terminal 1: Go API on :8090
# The placeholder file keeps go:embed happy before the first frontend build.
dev-api:
	@mkdir -p web/build/client && touch web/build/client/.keep
	go run .

# Terminal 2: Vite dev server on :5173, proxies /api to :8090
dev-web:
	cd web && npm run dev

# Build the frontend, then compile it into a single Go binary
build:
	cd web && npm run build
	go build -o dispatcher .

# Standalone API client. It only uses the Go standard library, so it does not
# pull the server or DuckDB into the resulting binary.
build-cli:
	CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=$(CLI_VERSION)" -o dispatcherctl ./cmd/dispatcherctl

install-cli:
	CGO_ENABLED=0 go install -trimpath -ldflags "-X main.version=$(CLI_VERSION)" ./cmd/dispatcherctl

run: build
	./dispatcher

clean:
	rm -rf dispatcher dispatcherctl web/build
