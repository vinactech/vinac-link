# Networks, Tailscale and ports

## Same network

Devices talk directly on **port 47800** (TCP). The page and the agent API are on **47801**, bound to
`127.0.0.1` only. Allow Node.js on *private* networks when your OS asks.

Some Wi-Fi networks (offices, hotels, cafés) block devices from reaching each other ("client
isolation"). Use Tailscale there.

## Tailscale

If both computers run [Tailscale](https://tailscale.com), VINAC Link uses it automatically:

- Each device tells the other its Tailscale address when pairing and whenever it proves its identity.
- When the usual address doesn't answer, the sender tries the Tailscale address and **switches only
  if the device proves, there, that it holds the pairing key**.
- To pair with a device that's never been on your network: *announce over Tailscale* on the page and
  type the code on the other device.

Candidate addresses are limited to private ranges (10/8, 172.16/12, 192.168/16), link-local
(169.254/16, a direct cable), Tailscale (100.64/10) and loopback, so a peer can't point your device
at the open internet. Tailscale itself needs the internet to connect the first time.

## No internet

VINAC Link never needs the internet. Any of these work, as long as the two computers can reach each
other:

- a router or Wi-Fi with its internet unplugged;
- a **phone hotspot** or a laptop's hotspot (Windows: Settings → Mobile hotspot), even without mobile data;
- a **network cable** straight between two computers: with no router, each gives itself a
  169.254.x.x address, and VINAC Link uses it when nothing better exists. A device paired over Wi-Fi
  also offers its cable address, so plugging in a cable later keeps working once the device proves
  itself there.

See [offline use](offline.md) for the whole picture.

## Moving between networks

A device that shows up from a new address (new Wi-Fi, VPN, cable) is only trusted there after the
same proof. Until then, messages go to the last proven address or a proven candidate.

## No network at all

Pairing by sound works without a network only for the beacon; the key exchange that follows needs
the devices to reach each other. Messages always need a network today. Delivery on a USB stick
(sealed bundles) is on the roadmap.
