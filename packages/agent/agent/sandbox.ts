import { defineSandbox } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";

const APT_PACKAGES =
  "python3 python3-pip python3-lxml libreoffice pandoc poppler-utils zip unzip fonts-liberation";

export default defineSandbox({
  backend: microsandbox({ memoryMiB: 2048 }),
  async bootstrap({ use }) {
    const sandbox = await use();

    await sandbox.run({
      command: `sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${APT_PACKAGES}`,
    });
    await sandbox.run({
      command:
        "pip3 install openpyxl pandas markitdown || pip3 install --break-system-packages openpyxl pandas markitdown",
    });
    await sandbox.run({
      command: "command -v npm >/dev/null || sudo apt-get install -y -qq nodejs npm",
    });
    await sandbox.run({
      command: 'NPM_CONFIG_PREFIX="$HOME/.local" npm install -g --silent docx',
    });
    await sandbox.run({
      command: `echo 'export NODE_PATH="$HOME/.local/lib/node_modules"' | sudo tee /etc/profile.d/anchor-node-path.sh >/dev/null`,
    });
  },
  async onSession({ use }) {
    await use({ networkPolicy: "deny-all" });
  },
});
