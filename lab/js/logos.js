export const LOGOS_VERSION = '0.2.0';
export const CANONICAL_INTENTS = Object.freeze([
  'calendar.appointment.create','calendar.appointment.list',
  'communication.message.reply','communication.message.send',
  'crm.contact.create','crm.contact.read','crm.contact.search','crm.contact.update',
  'crm.deal.create','crm.deal.list','crm.deal.read','crm.deal.update',
  'crm.note.create','crm.note.list','crm.task.complete','crm.task.create','crm.task.list','crm.task.update',
  'document.file.list','document.file.move','document.file.read','document.file.rename','document.file.search','document.file.write',
  'document.folder.create','document.folder.list','document.metadata.read','storage.account.read',
  'system.command.execute','system.process.control'
]);

export function isCanonicalIntent(intent){ return CANONICAL_INTENTS.includes(intent); }
export function intentId(intent){ const i=CANONICAL_INTENTS.indexOf(intent); if(i<0) throw new Error('non-canonical Logos intent'); return i; }
export function intentFromId(id){ return CANONICAL_INTENTS[id] ?? null; }
