---
name: status
description: Check that VINAC Link is running on this computer and which paired devices are reachable, and fix common problems. Use when the person asks if VINAC Link works, why a message didn't arrive, or what is paired.
---

# VINAC Link status and troubleshooting

1. Call `vinac_status` and `vinac_peers`. Report in plain words: this device's name,
   the key store in use, paired devices and whether each is online, unread messages.
2. If something is wrong, the person can run this in a terminal for a full check:
   `node "${CLAUDE_PLUGIN_ROOT}/connector/bin/vinac.mjs" doctor`
3. Common fixes:
   - **Other device offline**: VINAC Link must be running there too (it starts the first time
     an agent uses it, or with `vinac daemon`). Both must be on the same network.
   - **"different VINAC Link version"**: update the plugin on both computers.
   - **Key store error**: VINAC Link stops rather than storing keys in a plain file; on macOS
     allow Keychain access when asked.
   - **Firewall prompt**: allow Node.js on private networks so the other device can connect
     (port 47800).
