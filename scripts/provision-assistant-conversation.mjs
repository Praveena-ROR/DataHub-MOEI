// Creates tbl_MOEI_AssistantConversation (myapp_tbl_moei_assistantconversation):
// one row per Business Division Assistant conversation, owned by the user who
// started it. Additive and idempotent; touches no other table.
//
// Rows are User-owned, so with the privileges below each user can only read and
// change their own conversations; Dataverse enforces this server-side.
//
// Usage (Azure CLI signed in as System Customizer/Administrator):
//   node scripts/provision-assistant-conversation.mjs https://<org>.crm.dynamics.com
//   node scripts/provision-assistant-conversation.mjs https://<org>.crm.dynamics.com --role "<security role name>"
// --role grants Create/Read/Write/Delete at User (Basic) depth on this table to
// that security role (the role your BusinessDivision users hold). Run it once per role.
import { addAlternateKey, addColumns, connect, dateTime, memo, publish, text } from './lib/dataverse-admin.mjs';

const TABLE = 'myapp_tbl_moei_assistantconversation';
const SCHEMA = 'myapp_tbl_MOEI_AssistantConversation';
const dv = connect(process.argv[2]);
const roleArg = process.argv.indexOf('--role');
const roleName = roleArg > 0 ? process.argv[roleArg + 1] : undefined;

const label = (t) => ({
  '@odata.type': 'Microsoft.Dynamics.CRM.Label',
  LocalizedLabels: [{ '@odata.type': 'Microsoft.Dynamics.CRM.LocalizedLabel', Label: t, LanguageCode: 1033 }],
});

const exists = (await dv.call('GET', `EntityDefinitions?$select=LogicalName&$filter=LogicalName eq '${TABLE}'`)).value.length > 0;
if (exists) {
  console.log(`skip   table ${TABLE} (exists)`);
} else {
  await dv.call('POST', 'EntityDefinitions', {
    '@odata.type': 'Microsoft.Dynamics.CRM.EntityMetadata',
    SchemaName: SCHEMA,
    DisplayName: label('tbl_MOEI_AssistantConversation'),
    DisplayCollectionName: label('tbl_MOEI_AssistantConversations'),
    Description: label('Business Division Assistant conversations; one row per conversation, owned by the user who started it'),
    OwnershipType: 'UserOwned',
    HasActivities: false,
    HasNotes: false,
    IsActivity: false,
    Attributes: [{
      '@odata.type': 'Microsoft.Dynamics.CRM.StringAttributeMetadata',
      SchemaName: 'myapp_Title',
      IsPrimaryName: true,
      MaxLength: 200,
      FormatName: { Value: 'Text' },
      RequiredLevel: { Value: 'None' },
      DisplayName: label('Title'),
      Description: label('The first question of the conversation, shown in Chat History'),
    }],
  });
  console.log(`added  table ${TABLE}`);
}

// Must match ASSISTANT_COLUMNS in src/data/assistant.ts and README.md.
await addColumns(dv, TABLE, [
  text('myapp_ConversationId', 'ConversationId', 200, 'Copilot Studio conversation ID (x-ms-conversation-id)'),
  text('myapp_BotId', 'BotId', 100, 'Copilot Studio BotId from the transcript metadata (Business Division Assistant)'),
  text('myapp_UserUpn', 'UserUpn', 320, 'Host-verified sign-in address of the owner, set by the app'),
  memo('myapp_Messages', 'Messages', 1048576, 'JSON array of {role, text, at}: the user and assistant messages shown in the chat'),
  dateTime('myapp_LastActivityOn', 'LastActivityOn', 'When the last message was sent or received'),
]);

await publish(dv, [TABLE]);

// One row per conversation.
await addAlternateKey(dv, TABLE, 'myapp_key_assistantconversationid', 'Conversation ID key', ['myapp_conversationid']);

if (roleName) {
  const roles = (await dv.call('GET', `roles?$select=roleid,name,_businessunitid_value&$filter=name eq '${roleName.replace(/'/g, "''")}' and _parentroleid_value eq null`)).value;
  if (roles.length === 0) throw new Error(`Security role "${roleName}" not found.`);
  const names = ['Create', 'Read', 'Write', 'Delete'].map((p) => `prv${p}${SCHEMA}`);
  const privileges = (await dv.call('GET', `privileges?$select=privilegeid,name&$filter=${names.map((n) => `name eq '${n}'`).join(' or ')}`)).value;
  if (privileges.length !== names.length) throw new Error(`Expected ${names.length} privileges for ${SCHEMA}, found ${privileges.length}.`);
  for (const role of roles) {
    await dv.call('POST', `roles(${role.roleid})/Microsoft.Dynamics.CRM.AddPrivilegesRole`, {
      Privileges: privileges.map((p) => ({ Depth: 'Basic', PrivilegeId: p.privilegeid, BusinessUnitId: role._businessunitid_value })),
    });
    console.log(`granted ${privileges.map((p) => p.name).join(', ')} at User depth to "${role.name}"`);
  }
}
