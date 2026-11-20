// Settings from the environment: VINAC_<NAME>, or the older AGENTLINK_<NAME>
// (devices set up before the rename keep working).
export const env = name => process.env[`VINAC_${name}`] ?? process.env[`AGENTLINK_${name}`];
