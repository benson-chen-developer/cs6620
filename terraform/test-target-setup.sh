#!/bin/bash
# Stop immediately if any command fails, print each command
# before running it, and the whole thing fails if any line fails
set -euxo pipefail

# Install node and npm
dnf install -y nodejs npm

# Write the test target code, passed in from Terraform
mkdir -p /opt/test-target
cd /opt/test-target
echo '${package_json_b64}' | base64 -d > package.json
echo '${test_target_js_b64}' | base64 -d > test-target.js

# Install dependencies
npm install --omit=dev

# Run the test target and restart if it crashes
cat > /etc/systemd/system/test-target.service <<'EOF'
[Unit]
Description=Pentest test target
# Start after network services are up
After=network.target

[Service]
WorkingDirectory=/opt/test-target
ExecStart=/usr/bin/node test-target.js
Restart=always

[Install]
# Used by "systemctl enable" to start the service at boot
WantedBy=multi-user.target
EOF

# Load the new service file, and start it now and with every boot
systemctl daemon-reload
systemctl enable --now test-target