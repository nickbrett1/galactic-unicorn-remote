#!/bin/bash
# This file is executed once per session to set up the devcontainer.
# For example:
# echo "Running devcontainer setup script..."
# npm install

CURRENT_USER=$(whoami)
USER_HOME_DIR="$HOME"

echo "INFO: Restoring or backing up SSH host keys..."
sudo mkdir -p /var/lib/tailscale/ssh
if [ -n "$(ls -A /var/lib/tailscale/ssh/ssh_host_* 2>/dev/null)" ]; then
    echo "INFO: Restoring SSH host keys from /var/lib/tailscale/ssh..."
    sudo cp -f /var/lib/tailscale/ssh/ssh_host_* /etc/ssh/
    sudo chmod 600 /etc/ssh/ssh_host_*_key
    sudo chmod 644 /etc/ssh/ssh_host_*_key.pub 2>/dev/null || true
else
    echo "INFO: Backing up SSH host keys to /var/lib/tailscale/ssh..."
    sudo ssh-keygen -A || true
    sudo cp -f /etc/ssh/ssh_host_* /var/lib/tailscale/ssh/
fi

echo "INFO: Ensuring SSH service is running..."
sudo service ssh restart



echo "INFO: Creating Oh My Zsh custom directories..."
mkdir -p "$USER_HOME_DIR/.oh-my-zsh/custom/themes" "$USER_HOME_DIR/.oh-my-zsh/custom/plugins"

if [ -f "/workspaces/galactic-unicorn-remote/.devcontainer/.zshrc" ]; then
    echo "INFO: Copying .zshrc to $USER_HOME_DIR/.zshrc"
    cp "/workspaces/galactic-unicorn-remote/.devcontainer/.zshrc" "$USER_HOME_DIR/.zshrc"
    sudo chown "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.zshrc"
else
    echo "INFO: /workspaces/galactic-unicorn-remote/.devcontainer/.zshrc not found, skipping copy."
fi

if [ -f "/workspaces/galactic-unicorn-remote/.devcontainer/.p10k.zsh" ]; then
    echo "INFO: Copying .p10k.zsh to $USER_HOME_DIR/.p10k.zsh"
    cp "/workspaces/galactic-unicorn-remote/.devcontainer/.p10k.zsh" "$USER_HOME_DIR/.p10k.zsh"
    sudo chown "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.p10k.zsh"
else
    echo "INFO: /workspaces/galactic-unicorn-remote/.devcontainer/.p10k.zsh not found, skipping copy."
fi

if [ -f "/workspaces/galactic-unicorn-remote/.devcontainer/.tmux.conf" ]; then
    echo "INFO: Copying .tmux.conf to $USER_HOME_DIR/.tmux.conf"
    cp "/workspaces/galactic-unicorn-remote/.devcontainer/.tmux.conf" "$USER_HOME_DIR/.tmux.conf"
    sudo chown "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.tmux.conf"
else
    echo "INFO: /workspaces/galactic-unicorn-remote/.devcontainer/.tmux.conf not found, skipping copy."
fi








# Setup node dependencies and expose node_modules/.bin on PATH
# (memo: genproj node devcontainer .venv PATH — same class of bug as python
# .venv). postCreate runs with the workspace as CWD, but cd explicitly so
# this also works when invoked from elsewhere.
cd "/workspaces/galactic-unicorn-remote" 2>/dev/null || true

if [ -f "package.json" ]; then
    # genproj-npm-pin: activate the npm pinned in package.json. npm 10 bundled
    # with Node <24 crashes installing vitest-4 projects ('edgesOut'), and
    # packageManager/corepack alone does NOT switch npm (corepack only shims
    # yarn/pnpm) - so install the pinned version globally, mirroring CI.
    PINNED_NPM="$(node -p "try{require('./package.json').packageManager}catch(e){''}" 2>/dev/null || true)"
    if [ -n "$PINNED_NPM" ]; then
        VERSION="${PINNED_NPM#npm@}"
        CURRENT="$(npm --version 2>/dev/null || echo '')"
        if [ "$VERSION" != "$CURRENT" ]; then
            echo "INFO: Activating pinned ${PINNED_NPM} (image npm: ${CURRENT:-unknown})..."
            (npm install -g "npm@${VERSION}" 2>/dev/null || sudo npm install -g "npm@${VERSION}") || echo "WARN: Could not activate pinned npm ${VERSION}; continuing with $(npm --version 2>/dev/null)"
        fi
    fi
    echo "INFO: Installing dependencies with npm install..."
    npm install
fi

# genproj-node-bin-path: expose node_modules/.bin on PATH for shells that do
# NOT inherit devcontainer.json remoteEnv (VS Code terminals get PATH from
# remoteEnv; ssh / 'bash -lc' / tmux panes started outside VS Code do not).
# The marker comment keeps this idempotent across post-create re-runs.
NODE_BIN_MARKER='# genproj-node-bin-path'
if ! grep -qF "$NODE_BIN_MARKER" "$HOME/.bashrc" 2>/dev/null; then
    cat >> "$HOME/.bashrc" <<'EOF'
# genproj-node-bin-path: prefer project node_modules/.bin
if [ -d "/workspaces/galactic-unicorn-remote/node_modules/.bin" ]; then
    export PATH="/workspaces/galactic-unicorn-remote/node_modules/.bin:$PATH"
fi
EOF
    echo "INFO: Added node_modules/.bin PATH hook to ~/.bashrc"
fi
if ! grep -qF "$NODE_BIN_MARKER" "$HOME/.zshrc" 2>/dev/null; then
    cat >> "$HOME/.zshrc" <<'EOF'
# genproj-node-bin-path: prefer project node_modules/.bin
if [ -d "/workspaces/galactic-unicorn-remote/node_modules/.bin" ]; then
    export PATH="/workspaces/galactic-unicorn-remote/node_modules/.bin:$PATH"
fi
EOF
    echo "INFO: Added node_modules/.bin PATH hook to ~/.zshrc"
fi



echo "INFO: Configuring git safe directory..."
git config --global --add safe.directory /workspaces/galactic-unicorn-remote



echo "INFO: Installing git pre-commit hooks (lint-staged)..."
(cd /workspaces/galactic-unicorn-remote && npx --yes simple-git-hooks) || echo "WARN: Run 'npx simple-git-hooks' to install hooks manually."









echo "INFO: Checking Tailscale status..."
if ! command -v tailscale &> /dev/null; then
    echo "INFO: Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! pgrep -x tailscaled > /dev/null; then
    echo "INFO: Starting Tailscale daemon..."
    sudo start-stop-daemon --start --background --oknodo --pidfile /var/run/tailscaled.pid --make-pidfile --exec /usr/sbin/tailscaled -- --state=/var/lib/tailscale/tailscaled.state
fi

echo "INFO: Custom container setup script finished."
