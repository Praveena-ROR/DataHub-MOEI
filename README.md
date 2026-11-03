# MOEI Yearly Datasets Integration (Data Division app)

A Power Apps Code App (React + TypeScript + Vite) for MOEI dataset requests.

* **Business division data stewards** find the datasets mapped to their division and create a request for the ones they need. Each request has its own Request ID. Stewards then fill in and submit their division's values.
* **DG Admin** reviews a request once every participating division has submitted. They can ask divisions for clarification, approve or reject (with a decision comment or reason), and download a PDF report of the completed request.

Requirements: `Data_Division_Updated_Requirements.md`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests: workflow rules, setup check, write operations (in-memory store) and the PDF report |
| `npm run test:integration` | Runs the write operations against live Dataverse (see below) |
| `npm run lint` | ESLint |
| `pa app run` | Run locally inside the Power Apps host (needed for sign-in and data) |
| `pa app push` | Publish to the environment in `power.config.json` |
| `pa app refresh data-source` | Regenerate `src/generated` after a schema change |

## Screens

Dataset IDs are shown as `DS-001`, `DS-018`, … (the mapping's `myapp_datasetnumber`), on every screen and in the PDF report.

| Who | Screen | What it does |
| --- | --- | --- |
| Division | **Dashboard** | KPI cards (total, in progress, pending DG Admin review, approved, rejected, approved datasets), a line chart of requests created per **month**, one line per selected **year** (multi-select of the years in the data; clicking a point filters My Requests to that month) and a bar chart of requests by status. Clicking a card, month or bar opens My Requests with that filter. Below them, **My Datasets**: datasets with an **Approved** request the division took part in, each listed once, with search and **View** (read-only). All figures count unique Request IDs. |
| Division | **My Requests** | One row per request the division takes part in: Request ID, Dataset, Created on, Status, Actions. Every column has a multi-select filter in the header (Created on filters by month). **Continue/Open** while the division can still edit; **View** after it submitted or the request was decided. **Create New Request** opens the modal below. |
| Division | **Create New Request** (modal) | Lists only datasets that still have attributes of the division (owned or shared) that are **not already in a request** that is in progress, pending review or approved, and for each only those attributes (a rejected request frees its attributes). So with REQ_x open for attributes 1 and 2 of dataset 1, the modal offers only attributes 3 and 4 of dataset 1. Attributes mapped only to other divisions are never shown and are refused by the data layer. Nothing is created until **Create** is selected; one request per dataset, each recorded as a request row with the next free Request ID; the dialog then lists the Request IDs, with **Open**. |
| Division | **Request details** | A request covers only attributes mapped to the division that **raised** it; another division takes part only through attributes it shares with that division (older requests that stored other divisions' exclusive attributes are read the same way, except attributes that already have saved values). Only attributes mapped to the user's division (owned and shared) are shown. For a shared attribute, each mapped division has its own value cell; the user edits only their own, only while its contribution is a draft, and sees the other divisions' values read-only, drafts included. **Submit** looks disabled until every value is entered; selecting it earlier highlights the missing values. **Save Draft** is always available; the app warns before leaving with unsaved changes. Clarifications addressed to the division have a reply box. |
| DG Admin | **Dashboard** | KPI cards (Pending DG Admin Review, Approved, Rejected, In progress with divisions, Pending clarification) and two charts: **requests raised by division, by status** (stacked bars with legend, totals, hover text and a table view) and **requests by status**. All figures count unique Request IDs. Selecting a card, bar or segment opens the Review screen with that filter. |
| DG Admin | **Review** | Every request: Request ID, Dataset, Divisions (each participating division's submission status), Status, Actions. Every column has a multi-select filter; filters from the Dashboard (open clarifications, raised by a division) show as removable chips. **Review** for requests pending DG Admin review, **View** otherwise, and **PDF** once decided. Filters are kept when you return from a request. |
| DG Admin, Admin | **Admin Centre** | For `myapp_userrole = DG Admin` (alongside Dashboard and Review) and `Admin` (Admin Centre only); never for BusinessDivision. **Dataset & Attribute Management**: dataset list (from the mapping table, plus reference rows with no attributes), details, and a 3-step create/edit form with any number of attributes (up to the reference table's 45 columns), each with unit, description, classification, value type, comments and one or more business divisions (two or more = shared). Saves one `tbl_MOEI_DatasetAndBusinessMaps` row per attribute and the `tbl_MOEI_DatasetWithAttributes` row. Attributes used by any request keep their name, unit and divisions and cannot be removed; datasets are never removed (only View and Edit); unused attributes can be removed while editing (the row is deactivated). Selecting a dataset opens a details pop-up. Dataset IDs and User IDs are assigned automatically. **User Management**: list, view, add and edit `tbl_MOEI_UserDetails` records (existing or new roles and designations; a new business division exists once a user is saved with it as their designation); one active record per sign-in address, unique User ID, the last Admin and the last user of a mapped division are protected. |
| DG Admin | **Request details** | All values per division, clarification history (with **Request clarification**, **Ask follow-up** and **Mark resolved**), and the decision panel with its comment or reason. The reviewer is shown with their role. After a decision, **Download PDF Report**. |

## Dataverse tables

| Data source | Logical name | Use |
| --- | --- | --- |
| tbl_MOEI_DatasetAndBusinessMaps | `myapp_tbl_moei_datasetandbusinessmap` | One row per dataset attribute. `myapp_datasetnumber` is the dataset key. `myapp_businessdivision` holds the division name(s). A shared attribute lists several divisions separated by `/`, e.g. `Generation / BD&E`. `myapp_attributeclassification` feeds the Classification filter. |
| tbl_MOEI_UserDetails | `myapp_tbl_moei_userdetails` | **The only source of sign-in mapping, division and role** (details below). |
| tbl_MOEI_requests | `myapp_tbl_moei_request` | One row per request × attribute × division value, linked to the request by `myapp_requestid`. A shared attribute gets a separate row for each division. |
| tbl_MOEI_DGAdminApproval | `myapp_tbl_moei_dgadminapproval` | **Review log.** One row per request comment, attribute clarification or decision, linked by `myapp_requestkey` = Request ID. |
| tbl_MOEI_DatasetWithAttributes | `myapp_tbl_moei_datasetwithattributes` | Connected for reference. Not used: it holds one column per attribute (`myapp_attribute10`…`45`, `myapp_naturalgasoutput`, …) with no stable link to the mapping rows, so it can't be joined safely. |
| tbl_MOEI_AssistantConversation | `myapp_tbl_moei_assistantconversation` | **Business Division Assistant chat history.** One User-owned row per conversation (details under *Business Division Assistant*). Added 28 Oct 2026. |

**The app uses exactly these six tables** (plus the system ConversationTranscript table, connected but not read; see *Business Division Assistant*). tbl_MOEI_RequestHeader (`myapp_tbl_moei_requestheader`) and tbl_MOEI_BusinessDivisions (`myapp_tbl_moei_businessdivision`) were used by earlier versions; both were deleted from the Dataverse environment on 21 Oct 2026, with their rows. Requests are now recorded in tbl_MOEI_requests (below), and the division list in the Admin Centre comes from the designations of active `BusinessDivision` users.

**`tbl_MOEI_requests` and `myapp_tbl_moei_request` are the same table.** `tbl_MOEI_requests` is the display name and `myapp_tbl_moei_request` the logical name (entity set `myapp_tbl_moei_requests`). There is only one value store.

### Requests and Request IDs: request rows in tbl_MOEI_requests

There is no separate request table. Each request is recorded by one **request row** in tbl_MOEI_requests, next to the request's value rows. A request row has `REQUEST` in both `myapp_attributemapid` and `myapp_divisionname` (`RequestRows` in `src/data/workflow.ts`), so it can never be mistaken for a value.

| Column on the request row | Holds |
| --- | --- |
| `myapp_requestid` | **Request ID**, e.g. `REQ_0007`. |
| `myapp_datasetid`, `myapp_datasetname` | The dataset. |
| `myapp_submittedby`, `myapp_submittedon` | Who raised the request, and when. |
| `myapp_divisionid` | The requesting division. |
| `myapp_reviewcomments` | Mapping IDs of the selected attributes, comma separated, in dataset order. **Stored at creation**, so later mapping changes never change an existing request's submission gate. |
| `myapp_attributevalue` | Participating divisions, e.g. `Generation / BD&E`, for people browsing the table. |
| `myapp_reviewstatus` | Overall status as last recorded (`In Progress`, `Pending Review`, `Approved`, `Rejected`; the column holds 20 characters). The app always re-derives the status; a recorded DG Admin decision always wins. |

`myapp_divisionid`, `myapp_reviewstatus` and `myapp_reviewcomments` were unused legacy columns (empty on every row when this was introduced); they hold request details only on request rows.

**Request IDs.** A new request takes the next number after every Request ID already used in tbl_MOEI_requests (active or not) and tbl_MOEI_DGAdminApproval: `REQ_` and at least four digits. The alternate key `myapp_key_requestvalue` (`myapp_requestid`, `myapp_attributemapid`, `myapp_divisionname`) allows only one request row per Request ID, so if two requests are created at the same moment, the second insert is refused and that request takes the next number. Nothing is written apart from the request row; value rows appear when a division saves.

**Rules**

* **An attribute is in at most one request** that is in progress, pending review or approved. Several requests for one dataset can be open if they cover different attributes; a rejected request frees its attributes. Two requests created at the same moment for the same attribute: the later one is flagged and kept out of review.
* **A retried create never duplicates.** If a create succeeded but the answer was lost, trying again is refused because the attributes are already in that request, which is named in the message.
* **Status updates.** After every division write and every decision the app records the derived status on the request row. A failure there never undoes the write.

**Older requests (REQ_0003 to REQ_0006).** They were recorded in tbl_MOEI_RequestHeader, which was deleted with its rows, so they have value rows but no request row. The app rebuilds them from their value rows without writing anything (`requestsFromRows`): the requesting division must be mapped to every attribute of a request, so the request covers all attributes of the division(s) mapped to every saved attribute, plus every saved attribute. This doesn't change as other divisions save their shared values. Who raised them and when they were created are no longer known: **Created by** shows "Not recorded", and **Created on** is the earliest saved value. Requests that were created but had no saved value yet (and REQ_0001, REQ_0002) no longer exist.

### Value columns on tbl_MOEI_requests

`myapp_requestid` (existing column, now used), `myapp_datasetid`, `myapp_datasetname`, `myapp_attribute`, `myapp_divisionname`, `myapp_attributevalue`, plus the workflow columns created with `scripts/provision-request-columns.mjs`:

* `myapp_attributemapid`: mapping row ID, the stable attribute reference
* `myapp_submissionstatus`: `Draft` or `Submitted`
* `myapp_submittedby` and `myapp_submittedon`

`myapp_divisionid`, `myapp_reviewstatus` and `myapp_reviewcomments` hold the request details on request rows (above). Legacy and no longer read or written: `myapp_reviewedby` and `myapp_reviewedon`.

### Review log: tbl_MOEI_DGAdminApproval

| Column | Use |
| --- | --- |
| `myapp_approvalid` (alternate key) | Entry key: `<Request ID>:DECISION`, `<Request ID>:CLR:<attribute map id>:<division>:<n>`, `<Request ID>:CMT:<time>`. Dataverse rejects a second decision or a duplicate entry. |
| `myapp_requestkey` | Request ID. |
| `myapp_entrytype` | `Comment`, `Clarification` or `Decision`. |
| `myapp_datasetname`, `myapp_ownedby` | Dataset name and owning divisions (`Generation / BD&E`), for people browsing the table. |
| `myapp_status` | Decision `Approved`/`Rejected`, or clarification `Pending Response`/`Responded`/`Resolved`. |
| `myapp_comments` (2000) | Comment text, clarification question, approval comment or rejection reason. |
| `myapp_reviewedby` / `myapp_reviewedon` | Author and time. |
| `myapp_attributemapid`, `myapp_attributename`, `myapp_divisionname`, `myapp_submittedvalue` | Clarification target: the attribute, the division and the value when the question was asked. |
| `myapp_response`, `myapp_respondedby`, `myapp_respondedon` | The division's answer. |
| `myapp_resolvedby`, `myapp_resolvedon` | Resolution. |

### Users, divisions and roles: tbl_MOEI_UserDetails

| Column | Use |
| --- | --- |
| `myapp_usermailid` | Sign-in address. Matched exactly (ignoring case) against the address verified by the Power Apps host. |
| `myapp_userid` | User ID, shown on the sign-in screen and the profile card. |
| `myapp_userrole` | `BusinessDivision` (division steward) or `DG Admin`. Compared ignoring case and spaces. Any other value blocks access. |
| `myapp_userdesignation` | For `BusinessDivision` users, the **division name** (must match the mapping, e.g. `Generation`, `BD&E`). For other roles it's shown with the role, e.g. `DG Admin - Admin`. |
| `myapp_username` | The **only** source of the name shown for a person in the app and in the PDF report. |
| `statecode` | Only **Active** records grant access. |

* **Sign-in and identity.** The Power Apps host signs the user in before the app loads, and every Dataverse call runs under that sign-in. The app reads only the verified address (`getContext().user.userPrincipalName`) and looks it up in this table. It never asks for an email address, because an email match on its own is not authentication. Name, User ID, role and designation come only from the record. After sign-in the role decides the first screen: `BusinessDivision` → Division Dashboard, `DG Admin` → DG Admin Dashboard, `Admin` → Admin Centre.
* **Role checks are enforced in the app's data layer.** Every load and write re-resolves the user from this table. For enforcement outside the app (for example, someone calling the Dataverse API directly), give each group a Dataverse security role that limits these tables.
* **One active record per user.** These all block access with a specific message: no record, an inactive record, two or more active records, an unknown role, or a division user with no division.
* **Valid mapping divisions.** The divisions allowed in the mapping are the designations of active `BusinessDivision` users. A mapping name with no active user (e.g. a typo) is flagged and keeps that dataset out of review.

The **entry-screen setup check** (`src/data/schema.ts`) confirms the required columns on three tables: `REQUIRED_USER_COLUMNS`, `REQUIRED_REQUEST_COLUMNS` and `REQUIRED_REVIEW_COLUMNS`.
* **Missing columns** are named, but only when Dataverse confirms they're absent.
* **Other failures** show *Check again*.

## Business Division Assistant

A chat panel for the published Copilot Studio agent **Business Division Assistant**, opened from a floating button on every screen of **`BusinessDivision` users only**. It isn't rendered for DG Admin or Admin. The code is in `src/components/assistant/` (`BusinessAdminAssistant`, `ChatWindow`, `ChatHistory`, `ChatMessage`), `src/data/assistant.ts` (rules, unit tested in `scripts/assistant.test.ts`) and `src/data/assistantServices.ts`.

* **Access.** Before every agent call and every history read or write, `assistantServices.ts` re-resolves the signed-in user from tbl_MOEI_UserDetails (`requireDivision`) and refuses anyone who isn't an active `BusinessDivision` user. Hiding the button is convenience only.
* **Agent call.** The Microsoft Copilot Studio connector's `ExecuteCopilotAsyncV2` ("Execute Agent and wait"), with agent name `Default_BusinessDivisionAssistant` (bot.schemaname), body `{ message, notificationUrl: "https://notificationurlplaceholder" }`, and `x-ms-conversation-id` set to the conversation ID from the previous reply. The reply's `responses` (else `lastResponse`) are shown. The ID is read as `conversationId` / `ConversationId` / `conversationID`. A turn times out after 120 s. `ExecuteCopilot` is not used: it returns only a conversation ID, not the reply.
* **Failed turns.** The user's message always stays in the chat, marked **Not sent** (the connector call failed, so the agent never got it) or **Sent · no reply** (the agent got it, but no text came back). The error banner names the cause, and nothing is retried automatically.
  * **Usage limit:** HTTP 429/402, or "Copilot Credits" / "PaymentRequired" / quota wording in the error or in the agent's error-topic reply. Shown as *Assistant temporarily unavailable*, and Retry stays disabled for 60 s.
  * **Sign-in card:** a "Connect to continue" card, sent when an agent flow runs with the user's connection. The connector can't show it.
  * **Empty reply:** the SDK returns no data when the connector answers 201/202 while the agent is still working.
  * **Agent error-topic reply:** "Error code: …".

  The agent's error text is never shown as an assistant reply.
* **History: tbl_MOEI_AssistantConversation** (`myapp_tbl_moei_assistantconversation`, entity set `myapp_tbl_moei_assistantconversations`), created by `scripts/provision-assistant-conversation.mjs`. **User-owned**: the owner is set by Dataverse to the caller.

  | Column | Use |
  | --- | --- |
  | `myapp_title` (primary name) | First question, shortened; shown in Chat History. |
  | `myapp_conversationid` | Copilot Studio conversation ID. Alternate key `myapp_key_assistantconversationid`. |
  | `myapp_botid` | `1177b630-8b96-d3bc-ccdf-1d53e3120901`, the BotId in ConversationTranscript.metadata for this agent. |
  | `myapp_userupn` | Host-verified sign-in address of the owner. |
  | `myapp_messages` | JSON `[{role, text, at}]` of the messages shown (user and assistant text only). The oldest messages are dropped beyond 1,000,000 characters. |
  | `myapp_lastactivityon` | Time of the last message; history is sorted by it. |

  The row is created after the first reply and updated after each later one. Chat History lists rows filtered by Bot ID, the verified address and `_ownerid_value` = the host's `systemUserId`, and the app re-checks the same three on every row it reads.
* **Why not ConversationTranscript.** Transcript rows for this agent are owned by the "# Microsoft Copilot Studio" system user and written about 30 minutes after a session. They identify the person only as `from.aadObjectId` inside the `content` JSON. Dataverse can't limit reads to "own transcripts", so any role that can read them can read everyone's. The app therefore never reads transcripts. Give business division users **no** read privilege on ConversationTranscript.
* **Required security-role setup.** The security role held by business division users needs **Create, Read, Write and Delete at User depth (not Business Unit or Organization)** on tbl_MOEI_AssistantConversation. That depth is what makes Dataverse return only the user's own rows. Do not grant Assign or Share. Run `node scripts/provision-assistant-conversation.mjs https://<org>.crm.dynamics.com --role "<role name>"`. System Administrators see every row whatever the depth, so check isolation with ordinary accounts.
* **Agent access.** Restrict who can chat with the agent in Copilot Studio (Settings → Security → Authenticate with Microsoft, and limit access to a group of business division users). The app checks the role before calling, but the connector itself can't be locked to a role by the app.

## Workflow

* **Statuses** are derived from the value rows and the review log by `deriveRequestState`. They are never trusted from client state.
  * **Division status:** `Pending` (nothing saved), `Draft`, or `Submitted`. Submitted means every request attribute mapped to the division has a Submitted row with a **non-blank** value. A Draft value, a missing attribute or a submitted blank value keeps the division outstanding.
  * **In Progress:** the request stays here until every participating division has submitted, with no mapping or integrity problems.
  * **Pending DG Admin Review:** every participating division has submitted every value and there are no data issues. Until then the request page lists each outstanding division and the values it still owes ("BD&E has submitted 1 of 3 values; still outstanding: …"). `assertReviewable` re-checks the same per-division rule before any decision is saved, independently of the derived status, and the status recorded on the request row is re-synced after every write.
  * **Approved** or **Rejected:** taken from the decision row.
* **Save Draft** writes only the caller's division's rows, and blanks are allowed. **Submit** saves the latest values, stamps the submitter and time, and locks only that division.
  * **Required values:** every attribute a division owns needs a value before it can submit. The business confirmed this on 15 Oct 2026, overriding the requirements document's "optional" default.
* **Draft visibility.** All participating divisions see each other's saved values, drafts included, read-only.
* **Clarifications** (`Pending Response` → `Responded` → `Resolved`):
  * **Asking:** DG Admin asks one division about one submitted value. For a shared attribute the admin picks the exact division row.
  * **Answering:** only that division can answer, once. Its answer is kept.
  * **Follow-up:** after a response, **Ask follow-up** creates a new record, so the history is kept. A new question is refused while the division still owes an answer on that value.
  * **Approval:** any clarification that isn't Resolved blocks approval.
  * **Values stay locked:** clarifications never change or unlock submitted values.
* **Comments.** There are no separate request-level comments. DG Admin records an approval comment or rejection reason with the decision. (`writeComment` remains in `operations.ts` for older `Comment` rows; the app no longer shows or creates them.)
* **Decision.**
  * **Approve:** optional comment.
  * **Reject:** a reason is required.
  * **When:** a decision is possible only while the request is Pending DG Admin Review. Approval also needs every clarification resolved.
  * **What it does:** it writes a single `<Request ID>:DECISION` row (the alternate key blocks a second one) and records the status on the request row. Values stay locked.
  * **Rejection does not reopen anything.** The resubmission process has not been agreed.

## PDF report

* **Trigger:** **Download PDF Report** appears only after the decision is saved.
* **Source:** the app re-reads the request from Dataverse (`loadReportState`, DG Admin only) and builds the report with `src/report/reportModel.ts`. It renders it with jsPDF and jspdf-autotable (`src/report/pdf.ts`), which are loaded only when needed.
* **Contents:**
  * **A.** Summary: Request ID, dataset, created on, created by (the name of the person who created the request), requesting division(s) (every division in the request, listed once), submission time, decision time, and reviewer name with role (e.g. `Praveena (DG Admin - Admin)`).
  * **B.** Division submissions: status, submitted by, submitted on.
  * **C.** Every attribute with each division's separate value. Blanks are shown as "Blank / Not provided".
  * **D.** Timeline.
  * **E.** Every clarification round.
  * **F.** Final decision, with the approval comment or rejection reason.
  * **G.** Notes.
* **Timeline sources:** only events Dataverse stores, nothing invented:
  * request created, and each division's first save and submission
  * the moment all divisions had submitted (the latest submission)
  * clarification asked, responded and resolved
  * the decision and the report generation time

  Dataverse keeps only the latest values, not each draft save; the report says so.
* **Layout:** the DEWA logo header and "Page x of y" appear on every page. Table headers repeat, and long text wraps rather than clipping.
* **Delivery:** the PDF is downloaded and not stored anywhere. If generation fails, the decision is unaffected and **Try again** is offered. If the host blocks the download, an **Open the PDF** link is shown.
* **Text support:** jsPDF's built-in fonts cover Latin text. Arabic text would need an embedded font.

## Integration test

`scripts/integration.test.ts` runs `src/data/operations.ts` against the live request and review-log tables, using the real mapping and user-details rows for one dataset.

* **Run it:** `$env:DATAVERSE_URL='https://org204836a5.crm.dynamics.com'; npm run test:integration`. Optionally set `$env:ITEST_DATASET='2'`.
* **It writes to live Dataverse.** Run it only when that is intended.
* **Safety:** the test request is created for a dataset key `ITEST-<timestamp>` that no real dataset uses, so it never blocks or touches real requests. It takes the next free `REQ_` number like any request; every request row, value and review row it creates is deleted at the end, which frees that number again.
* **What it covers:**
  * **Request creation:** the request row and its Request ID, the second division refused for an attribute already in the open request, and the key refusing a second request row with the same ID.
  * **Division work:** draft visibility, separate shared values, other divisions' attributes refused, stale versions refused, blank submit refused, submit lock, and the all-divisions gate.
  * **DG Admin review:** comments, clarification on one division's shared value, a follow-up, answers only from that division, resolve, approval blocked while open, the decision key, rejection reason required, and approval.
  * **Value key:** checks the duplicate value key once Dataverse reports it Active.

## Security

The app re-checks everything on every load and write:
* it re-resolves the signed-in identity and user record (`currentSession`, `requireAdmin`, `requireDivision`);
* it re-reads the request row, the value rows and the review log from Dataverse;
* it validates the write: `planDivisionWrite`, `assertCanCreateRequest`, `assertReviewable`, `planClarification*`.

Specific checks:
* **Request access:** a division can only open requests for datasets mapped to it, and only create requests for those datasets.
* **Clarifications:** a division sees and answers only clarifications addressed to it.
* **DG Admin actions** (dashboard, queue, comments, clarifications, decisions, report) require the DG Admin role in tbl_MOEI_UserDetails.

Dataverse itself enforces two unique keys: value per request/attribute/division (which also allows one request row per Request ID), and one decision per request.

**These are not complete server-side controls.** A Code App calls Dataverse with the signed-in user's own permissions, so a user with table write access could bypass the app's rules with other tools (the Web API or a model-driven app). An administrator should:

1. **Security roles:**
   * Stewards: create and user-level write on **tbl_MOEI_requests**, with no delete. They also need read access on the mapping, request, review-log and user-details tables. Recording the status on a request row raised by someone else needs write on that row; without it the status is still derived correctly, only the recorded copy lags.
   * DG Admin: write on the review log, and write on tbl_MOEI_requests for the status on request rows.
2. **tbl_MOEI_DGAdminApproval:**
   * DG Admin needs create and write.
   * Division users need read, plus write limited by column security to `myapp_status`, `myapp_response`, `myapp_respondedby` and `myapp_respondedon`.
   * Only administrators should delete, because the table is the audit history.
3. **A server-side check** (a plug-in or Dataverse low-code plug-in) that rejects:
   * updates to Submitted value rows;
   * value writes whose `myapp_divisionname` isn't the caller's division in tbl_MOEI_UserDetails;
   * value writes for a request that has a decision row;
   * decisions, clarifications and resolutions by non-DG-Admin users;
   * clarification answers from another division.
4. **tbl_MOEI_UserDetails** should be read-only for everyone except administrators.

## Open questions (not decided in the app)

1. **Multi-select:** the app creates one request per selected dataset (working assumption).
2. **New request cycles:** the app allows a new request after a decision. Confirm, and whether a reporting year/period should be part of the request.
3. **Correction or resubmission** after a clarification or rejection: not implemented. Values stay locked.
4. **Who may download the PDF:** currently DG Admin only.
5. **Audit depth:** Dataverse keeps only the latest values, not every draft save. If full history is required, an audit/event table is needed.
6. **PDF storage:** download only. Storage in an approved location is not configured.
7. **Notifications:** none (no trigger or recipients confirmed).
8. **DEWA green** `#006D5C` is sampled from the supplied logo artwork. Replace it if brand guidelines give an official value.
