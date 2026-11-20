# Protocol v3: Noise

Status: built on the `noise` branch, not released. Replaces VINAC Link's own pairing and session
handshakes with the [Noise Protocol Framework](https://noiseprotocol.org/noise.html) (revision 34),
keeping what the person does (sound or code, then the 6-digit code swap) and what the rest of the
product relies on (pairing key, receipts, firewall, replay ledger).

## Building blocks

| | |
|---|---|
| Suite | `25519_ChaChaPoly_SHA256` |
| Code | `connector/src/noise.js`, Node's built-in crypto only, no dependencies |
| Checked by | the cacophony test vectors for NN, NNpsk0, KK, KKpsk0, XX, XXpsk3 (`connector/tests/fixtures/noise-vectors.json`, source and sha256 inside) |
| Device keys | the existing Ed25519 identity (its fingerprint is what the sound beacon carries) **plus** a new X25519 static key for Noise, created on first start of v3, wrapped by the OS key store (`agentlink.noise.<fingerprint>`) |
| Extra keys | `exportKeys(label)` = HMAC chain over the final chaining key with a per-use label. The Noise transport keys from `Split()` are not used for messages (see "Messages"). |

## Pairing: `Noise_XX`

Roles: the listener (heard the sound or typed the code) is the Noise **initiator**, the announcer is
the **responder**. Both know the beacon: announcer address and port, 8-byte one-time secret `S`, and
the announcer's identity fingerprint.

```
prologue = SHA256(len-prefixed: "VINAC pairing v3", "prologue", S)

1  listener  -> announcer   POST /pair/hello  { v:3, rid, m1 }
   m1 = XX msg 1 (-> e), payload (cleartext): { name, port, via, alt, commit = H(nB) }

2  announcer -> listener    response          { v:3, m2 }
   m2 = XX msg 2 (<- e, ee, s, es), payload (encrypted): { name, port, alt, idPub_A, nA }
   listener checks: fingerprint(idPub_A) == beacon fingerprint, port == beacon port

3  listener  -> announcer   POST /pair/reveal { v:3, rid, m3, sig_B }
   m3 = XX msg 3 (-> s, se), payload (encrypted): { idPub_B, nB }
   announcer checks: H(nB) == commit, sig_B over T with idPub_B

4  announcer -> listener    response          { sig_A }   listener checks sig_A over T with idPub_A

T     = SHA256("VINAC pairing v3", "transcript", h, idPub_A, idPub_B, nA, nB, meta)
        h = final handshake hash (covers both ephemerals, both X25519 statics, all payloads)
        meta = { v:3, roles, names, ports }
key   = exportKeys("pairing")             -> the pairing key, wrapped by the OS key store as before
codes = 6 digits = SHA256("VINAC pairing v3", "compare", role, T) mod 10^6, one per role
```

Then, as in v2: each device shows its own code, the person types it into the other device (3 tries),
and HMAC confirmations (`"VINAC pairing v3 confirm <role>"` keyed with the pairing key) finish it.

Why each part is there:
- **Ed25519 signatures over T** tie the Noise static keys to the identity the beacon vouched for.
- **Commit to nB in message 1, reveal in message 3:** the announcer picks nA before it can know nB,
  and the listener fixes nB before it sees anything from the announcer, so neither side (nor a man
  in the middle playing either role) can search for keys that make the 6-digit codes match.
- **S in the prologue:** the handshake only completes for someone who has the beacon.

The peer record stores `proto: 3` and the peer's X25519 static key (`noiseKey`).

## Sessions: `Noise_KKpsk0` or `Noise_NNpsk0`

```
pattern  = KKpsk0 if both devices hold each other's Noise static key (paired with v3),
           NNpsk0 otherwise (paired with v2, both now on v3)
psk      = the pairing key
prologue = SHA256("VINAC session v3", pattern, initiator id, responder id)

1  initiator -> responder   POST /noise  { v:3, from, to, pattern, m1 }
   m1 payload (encrypted under the psk): { ts }
   responder: pattern must be KKpsk0 if it holds the initiator's static key (no downgrade to NN);
              |now - ts| <= 10 min; initiator's ephemeral key never seen before (replay ledger)
2  responder -> initiator   response     { v:3, m2, sid }
   sid = first 12 bytes of h, hex
keys     = exportKeys("session", 3) -> initiator-to-responder, responder-to-initiator, receipts
```

Sessions are renewed hourly or after 500 sends, as in v2. KK adds authentication by both static
keys on top of the pairing key; NN with the psk gives what v2 sessions gave, now in a standard
construction.

## Messages

Unchanged record layer, new label: AES-256-GCM with a random 96-bit nonce per request,
AAD `"VINAC messages v3" | kind | from | to | sid | port`, receipts are an HMAC over the exact
ciphertext with the receipt key. Bodies carry `v: 3`, and a v3 session only accepts `v: 3` bodies.
Noise's own transport (counter nonces) would need in-order delivery, which separate HTTP requests
don't give; the random nonce is safe for 500 sends per key.

## Talking to devices on v2

| This device | Other device | Result |
|---|---|---|
| v3 | v3 | v3 pairing; v3 sessions |
| v3 listener | v2 announcer | `/pair/hello` v3 gets `UNSUPPORTED_VERSION`, the listener retries with v2 |
| v2 listener | v3 announcer | the announcer answers the v2 hello with v2 |
| v3 | v2 (session) | `/noise` gets 404, falls back to the v2 `/session` |

**No going back:** once a session or pairing with a device succeeded at v3, its record says
`proto: 3`. From then on this device refuses v2 sessions from it (`DOWNGRADE_REFUSED`) and never
falls back to v2 when sending to it. Before that first success, someone on the network could block
`/noise` to keep two v3 devices on v2 sessions; v2 sessions are still authenticated by the pairing
key, so this keeps the old level, not less. v2 support is removed before 1.0.

## Unchanged

`/whoami` (address proofs), sound secrets and their key, file and secret sealing at rest, the
firewall, receipts and the replay ledger work as before. The v2 labels (`AgentLink pairing v2` …)
stay unchanged so v2 devices keep working.

## For the security review

- `noise.js` against the spec, especially psk handling (`e` also runs MixKey in psk mode), the
  `s` token length, and `Split()`.
- The pairing: commit/reveal ordering, what T covers, the fingerprint and port checks.
- Downgrade: `proto: 3` stickiness, the pattern check on `/noise`, the v2 fallbacks above.
- Exported keys: label separation between pairing, session and receipt keys.
