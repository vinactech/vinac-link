// 0.16.3: the one description of how pairing works, used by the agent tools (MCP), and kept word for
// word in the OpenClaw gateway (which ships on its own) and the page's checklist; a test compares them.
// Every way ends the same: both screens show the same 6 digits and the person presses Allow on both.

export const PAIR_ENDING = 'Both screens then show the same 6 digits: the person checks them and presses Allow on both devices. No tool can do this step, and you must not try to complete it any other way.';

export const PAIR_WAYS = {
  nearby: 'Same network: the person opens Pair a device on both computers and presses Pair next to the other one in the list.',
  invite: 'Another network: the person makes an invite on the other computer (Pair a device › Invite a device); you may run `vinac join <code>` here with it.',
  code: 'No list or no network discovery: Pair a device › More ways › Show a code here on one device, Enter a code on the other.',
  sound: 'By sound (beta): Play the sound on one device, Listen for it on the other (within a few metres).',
};

export const PAIR_SUMMARY = `Ways to pair: ${Object.values(PAIR_WAYS).join(' ')} ${PAIR_ENDING}`;

/** The checklist line on the page. */
export const PAIR_CHECKLIST = 'Pick it on the same network (or use an invite, a code or sound); compare 6 digits and press Allow on both.';
