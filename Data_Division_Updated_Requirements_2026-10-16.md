# Data Division Dataset Request Application

## Full Functional Requirements, UI Specification, Dataverse Design, Workflow Rules, and Claude Code Execution Brief

**Document version:** Updated requirements --- 16 October 2026\
**Target platform:** Microsoft Power Apps Code App\
**Frontend:** Existing React + TypeScript + Vite project\
**Data platform:** Microsoft Dataverse\
**Existing project folder:** `C:\Praveena\ROR\DataHub\Datahub-MOEI`\
**UI references:** Supplied DEWA portal screenshot, dataset-list/filter
screenshot, annotated `External Data Request portal(2).pdf`, and
supplied DEWA logo assets.

> **Priority rule:** This document consolidates the current requirements. Where an older implementation, earlier version of this document, or existing UI conflicts with this version, follow this version. Inspect actual Dataverse metadata before assuming any logical column name or relationship.
>
> **Latest business-division UI and attribute-visibility changes (16 October 2026):** The latest requirements in Section 17 are authoritative and supersede any conflicting earlier instructions, especially the previous Dataset Catalogue screen, the old business-division navigation layout, and any instruction to show every dataset attribute to every participating division. The business-division experience must have Dashboard, My Requests (with an in-page Create New Request modal), and My Datasets (approved datasets owned/requested by the current division). Do not retain a standalone Dataset Catalogue navigation page.

------------------------------------------------------------------------

# 1. Instructions to Claude Code

Act as a senior React/TypeScript, Power Apps Code Apps, Dataverse,
workflow, PDF-generation, and application-security engineer. Work
directly in the existing project. Read this complete document before
changing code.

## 1.1 Required approach

1.  Inspect the existing project, `package.json`, Vite and TypeScript
    configuration, app entry points, routing, styling, tests, Power Apps
    Code App configuration, connected data sources, and current
    implementation.
2.  Inspect the actual Dataverse table metadata, including
    logical/display names, primary keys, field types, choice values,
    lookups, relationships, and existing records.
3.  Preserve the existing Power Apps Code App setup and working
    functionality. Do not replace it with a new starter project or a
    standalone application.
4.  Use the project's existing supported Power Apps Code App data-source
    integration. Do not assume arbitrary browser `fetch` calls can
    access Dataverse.
5.  Use real Dataverse data in production. Do not hardcode datasets,
    attributes, divisions, requests, users, statuses, or approval
    decisions.
6.  Do not invent column names. Map the requirements to the real schema
    and report gaps.
7.  Implement actual changes, not just a plan or sample code.
8.  Run the existing build, lint, and tests; add tests for the new
    workflow. Fix failures before reporting completion.
9.  Do not push to Power Apps unless the build and tests pass and the
    app is ready. Never claim a deployment succeeded without the command
    confirming success.
10. If a table/column/permission is missing, continue implementing
    independent work and provide exact setup steps for the blocker.

## 1.2 Current Dataverse sources to inspect

The user reports these connected tables:

-   `myapp_tbl_moei_datasetandbusinessmap` --- main
    dataset/attribute/business-division mapping.
-   `myapp_tbl_moei_datasetwithattributes` --- dataset/attribute
    reference table.
-   `myapp_tbl_moei_businessdivision` --- business-division reference,
    including division information.
-   `myapp_tbl_moei_request` --- request/attribute-value table reported
    in CLI output.
-   `myapp_tbl_moei_userdetails` --- the new authoritative user
    details/authentication-role mapping table.
-   A separate DG Admin approval table already added to the app; inspect
    its exact logical name and schema.

A screenshot shows a table displayed as `tbl_MOEI_requests`, with
visible columns `DatasetID`, `Created On`, `DatasetName`, `Attribute`,
`DivisionName`, `AttributeValue`, and additional columns. **Do not
assume `tbl_MOEI_requests` and `myapp_tbl_moei_request` are the same
table.** Inspect metadata and connected-source configuration, then
identify which table is the correct active request store. Avoid
duplicate request stores.

The user explicitly wants `myapp_tbl_moei_userdetails` used for user
authentication/role resolution. Do not use
`myapp_tbl_moei_businessdivision` to authenticate users or determine
their role. The business-division table remains useful as reference data
for division names and mappings.

------------------------------------------------------------------------

# 2. Application purpose

Build a Data Division application where an authenticated data steward
can find datasets associated with their own business division and
**create a request for a selected dataset**. The app must not
automatically create a submission for every dataset just because it is
mapped to the division.

A request is a tracked business transaction with an automatically
generated unique Request ID. Participating divisions fill their own
attribute values in the request. Each division's values remain separate,
including for shared attributes. Values entered by one division must be
visible to other participating divisions for that same request,
including values still in Draft. A division may edit only its own
contribution while its portion is editable.

Once all participating divisions have submitted, the request becomes
eligible for DG Admin review. DG Admin can add request-level comments,
ask for clarification on a specific attribute/division, receive
responses, and approve or reject. Once the request is completed by an
approval/rejection decision, generate a downloadable PDF audit/report
containing the request lifecycle and all relevant details.

------------------------------------------------------------------------

# 3. Current business rules and decisions

## 3.1 Identity and division

-   Use the signed-in Microsoft 365/Power Apps identity; do not create a
    separate username/password login.
-   Resolve the current user through `myapp_tbl_moei_userdetails`.
-   The user must resolve to exactly one active business division and
    one authorized role.
-   If no mapping or multiple conflicting mappings are found, stop and
    show a clear access/configuration message. Do not guess or let the
    user choose a division to bypass authorization.
-   `myapp_tbl_moei_businessdivision` is a division reference/mapping
    source, not the authoritative user authentication source.
-   A user may belong to only one division under the current business
    rule.
-   DG Admin role checks must also use the authoritative user
    details/security configuration, not a client-side role flag.

## 3.2 Dataset visibility and request creation

-   A division user sees only datasets with at least one attribute
    mapped to their own division.
-   Never show all datasets globally to every division.
-   The dataset catalogue is a list of datasets available for that
    user's division, not a list of all datasets in the system.
-   A dataset request is created only when the user explicitly selects
    dataset(s) and chooses **Create New Request**.
-   The application must not create a request merely because the user
    opens a dataset or signs in.
-   Allow multi-selection of dataset rows using checkboxes, including
    select-all for the currently filtered page/list.
-   The user can initiate requests for multiple selected datasets in one
    action.
-   **Working assumption:** create one distinct request per selected
    dataset, with a unique Request ID for each. This avoids mixing
    datasets into one request and fits the dataset-level
    submission/approval model. If the business wants one request ID to
    cover multiple datasets, confirm that before changing the data
    model.
-   After request creation, display the generated Request ID and a
    confirmation. The request must also appear in the user's request
    list.
-   Prevent duplicate active requests for the same division and dataset
    where the existing business model expects only one active request.
    Inspect existing records and schema before deciding the exact
    duplicate rule; do not block a new request forever if a legitimate
    new reporting cycle is later supported.

## 3.3 Division contributions

-   The dataset/attribute/division mapping table is the authority for
    which divisions participate in each dataset and attribute.
-   Only divisions mapped to one or more attributes of the selected
    dataset are participating divisions for that request.
-   An unrelated division must not appear in the request detail,
    clarification routing, completion gate, or report.
-   A dataset can contain attributes owned by different divisions.
-   An attribute can be shared by two or more divisions.
-   Every participating division has its own contribution/status for a
    request.
-   Every division's value for a shared attribute is stored
    independently. Never let one division overwrite another division's
    value.
-   Values entered by one participating division must be visible to the
    other participating divisions on the same request **even while the
    value is in Draft**. Draft visibility is not private between
    participating divisions in this updated requirement.
-   Visibility does not grant edit permission. Users may edit only their
    own division's values while their division contribution is in an
    editable state.
-   Attribute values are optional unless the actual schema or an
    explicitly confirmed attribute-specific rule says otherwise. Blank
    fields must not automatically prevent saving or submitting.

## 3.4 Submission and locking

-   Save Draft saves only the current division's contribution and does
    not count as submission.
-   A division can return later and edit its own draft.
-   Submit marks only the current division's contribution as Submitted
    and locks that division's values.
-   Other participating divisions remain Draft/Pending until they submit
    their own portions.
-   The overall request remains `In Progress` while any participating
    division has not submitted.
-   Only after every participating division submits, and there are no
    data-mapping errors or required unresolved clarifications, does the
    request become `Pending DG Admin Review`.
-   A request in review or with a final decision is read-only to
    division users.
-   Rejection correction/resubmission behavior has not been confirmed.
    Do not silently unlock a rejected request or invent a resubmission
    process.
-   Do not use a separate `Published` status unless the business later
    confirms what it means. The current review-ready state is
    `Pending DG Admin Review`.

## 3.5 DG Admin and final report

-   DG Admin can view all relevant participating divisions and the
    complete request data for review.
-   DG Admin can add multiple request-level comments; prior comments
    must be preserved.
-   DG Admin can request clarification for a particular attribute and a
    particular division's contribution.
-   For a shared attribute, DG Admin must select the relevant division
    contribution when raising clarification.
-   The assigned division can view and respond to the clarification.
    Other divisions cannot respond to a clarification assigned
    exclusively to another division.
-   Clarification history must persist, including question, response(s),
    author, timestamps, status, and any follow-up.
-   A request must not be approved while required clarifications are
    unresolved.
-   Clarification must not automatically unlock submitted values. If
    correction is required, use an explicitly approved, auditable
    correction/resubmission workflow; do not silently modify or unlock
    the original submission.
-   DG Admin can approve or reject eligible requests, with reviewer
    identity, decision, timestamp, and comments/rejection reason
    recorded.
-   After the request reaches a final decision (`Approved` or
    `Rejected`), generate a PDF report. The PDF must contain the full
    request and its audit trail, including creation, requester, selected
    dataset, division submissions, attribute values, comments,
    clarifications and responses, decision, decision-maker, and
    timestamps.
-   Provide a **Download PDF Report** action for completed requests. The
    report must be generated from persisted Dataverse records, not just
    current screen state.

------------------------------------------------------------------------

# 4. User roles and permissions

## 4.1 Business Division Data Steward

A data steward can:

-   Enter through the organization's authenticated Power Apps session.
-   Resolve to exactly one division using `myapp_tbl_moei_userdetails`.
-   View the dataset catalogue filtered to datasets mapped to that
    division.
-   Filter and search datasets, select one or more datasets, and create
    new requests.
-   See the auto-generated Request ID after each request is created.
-   Open a request and view all relevant attributes and participating
    divisions for that dataset.
-   Enter/edit only their division's attribute values while their
    contribution is Draft.
-   See other participating divisions' values even while those values
    are Draft, but only read them.
-   Save Draft and resume it later.
-   Submit their own contribution.
-   View their submitted contribution after submission, without editing
    it.
-   See clarifications assigned to their division and respond to them.
-   View request comments/history available to participating divisions,
    according to the final access rules.
-   View their own requests and their statuses.

A data steward cannot:

-   See datasets unrelated to their division in the catalogue.
-   Manually switch division to gain access.
-   Edit another division's values.
-   Change a submitted contribution unless an explicit correction
    workflow is implemented.
-   Approve/reject requests.
-   Alter request IDs, submitter identities, timestamps, or decision
    metadata.

## 4.2 DG Admin

An authorized DG Admin can:

-   View requests eligible for review and previously decided requests.
-   View all participating divisions, their submission statuses, and
    their separate values for each attribute.
-   Add request-level comments.
-   Request clarification on a specific attribute and division
    contribution.
-   Review clarification responses and resolve or follow up.
-   Approve or reject eligible requests.
-   View approval/rejection history.
-   Download the final PDF report after a request is approved or
    rejected.

DG Admin must not be authorized merely because a user knows a route or
changes client-side state. Use `myapp_tbl_moei_userdetails` and
supported Dataverse/security controls to verify the role. Do not
hardcode admin email addresses.

------------------------------------------------------------------------

# 5. Dataverse table responsibilities and schema inspection

## 5.1 `myapp_tbl_moei_datasetandbusinessmap` --- primary mapping table

Use this table to determine:

-   Dataset identity/number/name.
-   Attribute identity/name.
-   Which business division is associated with each attribute.
-   Which datasets are available to a division.
-   Which divisions participate in a selected dataset.
-   Which division contributions are required before the request can
    advance to DG Admin review.

Inspect whether each row represents a dataset/attribute/division
mapping. Verify stable IDs, lookups, active status, duplicate mappings,
and actual logical names. Do not assume a dataset name uniquely
identifies a dataset; use stable IDs/keys.

## 5.2 `myapp_tbl_moei_datasetwithattributes` --- reference table

Use for reference metadata and attribute definitions where appropriate.
Inspect its relationships with the primary mapping table. Prefer stable
lookup/ID relationships over string matching. Detect ambiguous matches
rather than silently joining unrelated rows.

## 5.3 `myapp_tbl_moei_businessdivision` --- division reference table

Use for division names, identifiers, active status, and division
reference data. Do not use it as the source of user authentication or
role resolution. Do not show a division for a dataset unless that
division is mapped to at least one attribute of the dataset.

## 5.4 `myapp_tbl_moei_userdetails` --- authoritative user and role mapping

Use this table to identify the authenticated user and determine:

-   Stable user identity/email/UPN or Entra object ID, based on the
    actual schema.
-   Active/inactive status.
-   Business division assignment.
-   Role (for example, Data Steward or DG Admin), based on actual
    schema/approved security design.

Inspect the actual columns. Do not assume the table already contains
every conceptual field. If the table cannot represent the required
identity, division, or role safely, report the exact missing
field/relationship and propose the smallest schema change. Do not store
passwords.

## 5.5 Request store --- inspect `myapp_tbl_moei_request` and `tbl_MOEI_requests`

The CLI output names `myapp_tbl_moei_request`; a screenshot shows the
display title `tbl_MOEI_requests`. Inspect both and determine whether
they are the same table, display/logical name variants, or separate
tables.

The screenshot shows `DatasetID`, `Created On`, `DatasetName`,
`Attribute`, `DivisionName`, `AttributeValue`, and additional columns.
It does not establish all column names, relationships, or whether a row
represents a request header, attribute value, or division submission.

Reuse the correct existing table(s) if they can safely support the
workflow. Do not create duplicate request data stores. The data model
must support a unique request header/ID, division-specific submissions,
and independent attribute values. If the current table is only one row
per attribute value and has no reliable request grouping, inspect
whether an existing request/header table can provide that grouping. If
not, document and implement the minimum additional structure after
confirming permissions.

## 5.6 Existing DG Admin Approval table

Inspect the exact table name, columns, lookups, and relationships. Use
it to persist request-level approval/rejection decisions if its schema
supports that purpose. A single status field on each attribute-value row
is not an adequate substitute for one authoritative request-level
decision.

## 5.7 Additional data structures if needed

Do not create these blindly. First inspect all existing tables. Add the
minimum structures needed only when no existing equivalent is suitable.

### Request header (conceptual)

One record per request per dataset. It should support:

-   Auto-generated unique Request ID visible to users.
-   Stable Dataverse primary key.
-   Dataset reference.
-   Request creator identity and creation timestamp.
-   Overall request status.
-   Current/final decision status and metadata, or a relationship to the
    approval table.
-   Created/modified audit metadata.
-   Links to division submissions, comments, clarifications, and report
    metadata if needed.

Use a human-readable ID such as `MOEI-REQ-000001` only if it can be
generated safely and uniquely. Prefer a supported Dataverse autonumber
column if available. Do not generate IDs using an unsafe client-side
counter. If the existing schema has an auto-number field, reuse it.

### Division submission (conceptual)

One row per participating division per request. It should support:

-   Request lookup.
-   Division lookup.
-   Status: `Draft` or `Submitted` (and a derived/display `Pending`
    state when no submission exists).
-   Created/modified/submitted timestamps.
-   Submitter identity.
-   Safe locking state.
-   Version/concurrency metadata if supported.

### Attribute value (conceptual)

One row per attribute contribution per division submission. It should
support:

-   Division submission/request lookup.
-   Attribute reference.
-   Division reference, directly or through division submission.
-   Attribute value using the correct type/schema.
-   Created/modified metadata.
-   Stable identity and duplicate prevention.

A shared attribute must have separate records for each participating
division.

### Request comment (conceptual)

If existing schema cannot retain multiple comments, use a related
comment table with:

-   Comment ID.
-   Request lookup.
-   Comment text.
-   Author identity.
-   Created timestamp.
-   Comment type if needed (general, approval, rejection), without
    conflating comments with clarification records.

### Clarification (conceptual)

If existing schema cannot support multiple clarification exchanges and
their history, use a related clarification table or a suitable
parent/response model with:

-   Clarification ID.
-   Request lookup.
-   Dataset and attribute references.
-   Target division/contribution reference.
-   Clarification question.
-   Status (`Pending Response`, `Responded`, `Resolved`, optionally
    `Cancelled`).
-   Requested by and timestamp.
-   Resolution metadata.

If multiple responses or follow-up questions must be retained, use a
separate clarification-message/response child table instead of
overwriting the first response. Preserve history.

### PDF report metadata (optional)

Only add if needed to store report generation state/file reference:

-   Request lookup.
-   Generation status/time.
-   Generated by.
-   File reference/location using a supported secure storage pattern.
-   Report version/hash if required.

Do not store secrets or expose a public file URL. If the environment has
an approved file-storage approach, use it; otherwise generate the PDF
for download through the app's supported mechanism and document the
limitation.

------------------------------------------------------------------------

# 6. Request ID and request lifecycle

## 6.1 Create a new request

1.  User signs in and is resolved to one active division.
2.  User opens **Dataset Catalogue**.
3.  The catalogue shows only datasets mapped to that division.
4.  User selects one or multiple dataset rows using checkboxes.
5.  User clicks **Create New Request**.
6.  The application validates that each selected dataset is still mapped
    to the user's division and is eligible for a new request.
7.  The app creates a separate request per selected dataset (working
    assumption; see Section 3.2).
8.  Generate the Request ID through a safe unique
    server/Dataverse-supported mechanism.
9.  Create or initialize the required participating division submissions
    based on the mapping.
10. Show a success confirmation with each Request ID and dataset name.
11. Make the requests visible in the user's request list.
12. Do not create duplicates if the operation is retried after a
    timeout; use an idempotent strategy or detect an already-created
    request.

If a request fails partway through creation, do not display it as
successfully created unless Dataverse confirms the records were saved.
Handle partial creation safely and allow recovery without duplicate
requests.

## 6.2 Request statuses

Recommended overall request states:

-   `In Progress` --- at least one participating division is Draft,
    Pending, or not submitted.
-   `Pending DG Admin Review` --- all participating divisions have
    submitted and no required clarification is unresolved.
-   `Approved` --- DG Admin approved.
-   `Rejected` --- DG Admin rejected.
-   `Published` --- do not use unless the business later defines it as a
    separate lifecycle state.

Division contribution states:

-   `Pending` --- no contribution/submission exists yet (may be
    derived).
-   `Draft` --- contribution exists and remains editable by its owner
    division.
-   `Submitted` --- that division's contribution is submitted and
    locked.

Clarification states are separate from request and division statuses:
`Pending Response`, `Responded`, `Resolved`, and optionally `Cancelled`.

## 6.3 Save Draft

-   Save only the current division's own values.
-   Preserve other divisions' values and statuses.
-   Blank attribute values are allowed.
-   Save/modify the current division's contribution as `Draft`.
-   Do not advance the overall request to review.
-   Update modification metadata where available.
-   Show a success/error message.
-   Do not clear unsaved values before Dataverse confirms a successful
    save.
-   If a save conflict occurs, preserve the user's form state and offer
    refresh/reload guidance.

## 6.4 Submit

-   Verify the current user, division, request, and editable status.
-   Save the latest values for the current division.
-   Mark only that division's contribution as `Submitted`.
-   Record submitter and timestamp where supported.
-   Lock that division's values.
-   Recalculate overall status based on every participating division
    mapped to this dataset.
-   If any participating division is not submitted, keep `In Progress`.
-   If all participating divisions have submitted and there are no
    mapping errors or required unresolved clarifications, set
    `Pending DG Admin Review`.
-   Do not set `Approved` or `Published` when a division submits.

## 6.5 Shared attribute visibility, including Draft

Example: Attribute `Natural Gas` belongs to Generation and BD&E.

-   Generation enters `100` and saves Draft.
-   BD&E must be able to see Generation's `100` while it is still Draft,
    but cannot edit it.
-   BD&E enters `200` and saves Draft.
-   Generation must be able to see BD&E's `200` while it is still Draft,
    but cannot edit it.
-   Each division sees its own field editable while its contribution is
    Draft.
-   After one division submits, that division's value remains visible
    but locked.
-   The other division's draft remains editable by that other division.
-   The overall request remains `In Progress` until all participating
    divisions submit.

The application must not hide another participating division's draft
values. This supersedes any older requirement that says other divisions'
values are visible only after submission.

## 6.6 Completion and finalization

-   The request is complete only after the required division
    contributions are submitted and DG Admin has recorded a final
    decision.
-   A request waiting for DG Admin is not yet final.
-   An approved or rejected request is read-only to business divisions.
-   Rejection does not automatically unlock submitted data.
    Resubmission/correction behavior remains an open business decision.
-   Generate the PDF report after the final DG Admin decision is saved
    successfully.

------------------------------------------------------------------------

# 7. Business Division UI --- required screens (updated 16 October 2026)

The business-division experience has three primary screens: **Dashboard**, **My Requests**, and **My Datasets**. Creating a request must happen from the My Requests screen through a modal/dialog. Do not retain a separate Dataset Catalogue navigation page or a separate Drafts & Submissions page. Request details may open as a detail route/page from My Requests.

The latest detailed rules in Section 17 take precedence if any earlier section conflicts with them.

## 7.1 Shared shell

- Keep the existing DEWA branding, logo, green theme, header, signed-in user name/division, and supported sign-out behavior.
- Use the existing React + TypeScript Power Apps Code App and Dataverse integration.
- Use responsive layouts, consistent spacing, accessible labels/focus states, clear status text, and loading/error/empty states.
- Do not hardcode divisions, datasets, attributes, chart data, or request counts.

## 7.2 Screen A --- Business Division Dashboard

Purpose: provide a concise overview of the current division's requests and its approved/owned datasets.

Show summary KPI cards and useful charts based on live Dataverse records, such as:

- Total requests relevant to the current division.
- Draft / In Progress requests.
- Pending DG Admin Review requests.
- Approved requests.
- Rejected requests.
- Total datasets owned by the division (datasets with a request from this division that has reached Approved status).
- A chart showing request counts by overall status.
- A chart showing request counts by division contribution status or dataset, only where the data supports a meaningful chart.
- A recent requests table/list with Request ID, dataset, current division status, overall status, and an Open action.

Dashboard rules:

1. All counts and chart values must be calculated from actual Dataverse data and unique request IDs, not attribute-value rows.
2. The Dashboard's owned-dataset metric/list must include only datasets for which the current division has made a request and the request is Approved. Do not treat a dataset mapping alone as ownership.
3. Charts must respect the signed-in division's authorization scope. Do not include unrelated divisions' private request data.
4. Add Refresh and appropriate loading, empty, and error states.
5. Clicking a KPI/chart segment should navigate to My Requests with the corresponding filter applied when practical.

## 7.3 Screen B --- My Requests

Purpose: show all requests relevant to the current division and provide the main entry point to create new requests.

Show one row per unique request, not one row per attribute-value record. Recommended columns:

- Request ID (generated, visible, and openable).
- Dataset number/ID and dataset name.
- Created date/time.
- Request creator, if available.
- Current division's contribution status.
- Overall request status.
- Clarification status, if relevant and supported.
- Actions: Open / Continue / View.

Requirements:

1. Place filters in a filter row within the table header, not in a separate filter panel above the table.
2. Include Request ID and dataset search plus filters for current division contribution status and overall request status.
3. Remove the `Last Activity` column entirely.
4. Include pagination and a result count.
5. Show requests created by or otherwise relevant to the current division, according to the actual request/submission relationships and authorization rules.
6. Draft/In Progress requests may be opened to continue the current division's contribution. Submitted or final requests open read-only unless a separately approved correction workflow exists.
7. Do not add a separate Drafts & Submissions navigation entry.
8. Include a prominent `Create New Request` button. Clicking it opens the modal described in Section 7.4; it must not navigate to a separate catalogue page.

## 7.4 Create New Request modal

Open this modal from My Requests. The modal must support dataset selection and attribute selection before the request is created.

### Dataset selection

- Search available datasets and show only datasets that have at least one attribute mapped to the current user's division.
- Support selecting one or multiple datasets, with a clear selected count.
- Prevent duplicate active requests when the existing business rule/data model says a request is already active.
- The current working assumption remains one unique request per selected dataset. Generate each Request ID using a safe Dataverse-supported mechanism and display all created IDs after successful creation.
- Validate mappings and eligibility at submission time. Prevent duplicate clicks and handle retries/partial failures safely.

### Attribute selection and visibility

- For each selected dataset, display **only attributes mapped to the logged-in division**, including attributes shared between the logged-in division and one or more other divisions.
- Do not show attributes owned exclusively by another division in the selection UI or in the business division's request-entry view.
- A shared attribute is an attribute whose mapping explicitly includes the logged-in division and at least one other division. Show the shared attribute to every division mapped to it.
- Show the owning/participating division labels beside attributes where useful, but do not reveal unrelated attribute rows.
- Allow selecting the attributes that this division is responsible for supplying, following the existing business rules. If the data model requires all attributes mapped to this division, preselect or enforce those attributes instead of allowing a selection that creates an invalid request; inspect existing behavior/schema and implement consistently.
- Explain how many attributes belong to this division and how many are shared, when those counts can be derived accurately.
- The request is created only after the user confirms the selection. Opening or closing the modal must not create a request.
- Show validation, loading, success, and error states. Do not clear selections on a failed save.

### Shared-attribute values

- For a shared attribute such as `Natural Gas`, each participating division must have its own independent value record/contribution; one division must never overwrite another division's value.
- Values saved by one participating division must be visible to all other divisions mapped to that **same shared attribute**, even while the value is in Draft.
- Draft visibility is read-only for other divisions. Each division may edit only its own value while its contribution is editable.
- Do not expose draft values for attributes that are exclusive to another division. Shared visibility applies to the shared attribute and its division-specific values only.

## 7.5 Screen C --- My Datasets (approved datasets owned by this division)

Purpose: show the datasets this division has requested and that have been approved by DG Admin.

- Show only datasets linked to a request involving the current division where the final overall request status is `Approved`.
- A dataset mapping alone, a draft, a submitted request, or a pending review must not make a dataset appear as owned/approved.
- Display dataset number/ID, dataset name, approval/request ID, approval status, and other useful metadata only where available in Dataverse.
- Allow opening approved dataset details in read-only mode unless a separately defined update workflow exists.
- Include search, pagination, refresh, and clear empty/error/loading states.
- Count unique approved datasets, not attribute rows or repeated requests for the same dataset.

## 7.6 Request Details / Attribute Entry

Open request details from My Requests or after request creation. Show the Request ID, dataset details, creation metadata, overall status, and the current division's contribution status.

Attribute visibility must follow ownership mapping:

- Show attributes mapped to the current division, including shared attributes.
- Hide attributes owned exclusively by other divisions from the business-division user.
- For a shared attribute, show the separate value for each division mapped to that attribute, including Draft values. The current division's value is editable only while its contribution is Draft/editable; other divisions' values are read-only.
- Never show a shared attribute as one common input or overwrite one division's value with another's.
- Do not reveal values for unrelated or exclusively other-division attributes merely because they belong to the same dataset.
- Show only participating divisions relevant to the attributes visible to the current division, while preserving enough request status information to explain overall progress without exposing unrelated attribute values.
- Save Draft saves only the current division's values. Submit locks only the current division's contribution. Keep blank values allowed unless a confirmed explicit validation rule applies.
- Show comments/clarifications that the current user is authorized to see, including clarification messages assigned to their division.
- Warn about unsaved changes and preserve entered values after save errors.

## 7.7 Clarifications for division users

- Display clarifications assigned to the current division on the relevant shared/owned attribute and request.
- Show the question, attribute, target division, requesting DG Admin, date/time, and status.
- Allow the current division to respond only to clarifications assigned to it.
- Preserve all messages and responses. Do not automatically unlock submitted values; any correction must follow an explicitly approved auditable correction workflow.

# 8. DG Admin UI and workflow

## 8.1 DG Admin dashboard

Provide an admin-only dashboard with:

-   Active business divisions.
-   Datasets and attributes mapped to each division.
-   Requests pending DG Admin review.
-   Approved and rejected requests.
-   Overall status and each participating division's submission status.
-   Search and filters within table headers where applicable.
-   Links/actions to open request details.

Use real Dataverse data. Do not show every division against a dataset if
the mapping does not associate that division with any attribute in the
dataset.

## 8.2 DG Admin request queue

Show requests whose overall status is `Pending DG Admin Review`, along
with previously decided requests where useful.

Recommended columns:

-   Request ID.
-   Dataset ID/number and name.
-   Request creator.
-   Created date/time.
-   Participating divisions.
-   Division submission progress.
-   Overall status.
-   Clarification status, if applicable.
-   Decision and decision timestamp for completed requests.
-   Action to open details/report.

A request must not enter the review queue until all participating
divisions have submitted. A draft counts as outstanding. Do not require
divisions unrelated to the selected dataset to submit.

## 8.3 DG Admin request details

Display a consolidated read-only review of:

-   Request ID and dataset details.
-   Request creator and creation time.
-   All participating divisions and their contribution statuses.
-   Every attribute and the divisions mapped to it.
-   Each division's separate attribute value, including values that were
    originally saved as drafts and later submitted.
-   Submission timestamps and submitter details where available.
-   Request-level comments.
-   Attribute-specific clarification history and responses.
-   Approval/rejection history.
-   Available actions based on current status.

Submitted business values must be read-only during review. DG Admin
comments and decision data must not overwrite the original attribute
values.

## 8.4 Request-level comments

DG Admin can add multiple comments to a request.

-   Persist each comment in Dataverse.
-   Associate it with the request.
-   Record author and timestamp where supported.
-   Display existing comments in chronological order.
-   Preserve older comments; never replace the comment history with the
    latest comment.
-   Adding a comment must not by itself change the request's approval
    status.
-   Show clear save/error feedback.

If the current approval table only supports one comment per decision and
cannot retain a comment history, use a suitable existing comments table
if present or propose the minimum additional related table.

## 8.5 Attribute-specific clarification

For every attribute contribution shown in the request details, provide a
`Request Clarification` action.

When an attribute is mapped to multiple divisions, DG Admin must
explicitly select which division's contribution needs clarification.

The clarification form must show:

-   Request ID.
-   Dataset ID/name.
-   Attribute name/reference.
-   Target division.
-   The relevant saved/submitted value, including its state.
-   A mandatory clarification question.
-   Send and Cancel actions.

On send:

-   Create a persistent clarification record/message.
-   Store the request, attribute, and target division references.
-   Store the question, requesting admin, timestamp, and status.
-   Set status to `Pending Response`.
-   Make it visible to the target division.
-   Trigger a notification only if an existing notification mechanism is
    configured or later approved; do not invent mandatory email
    behavior.

Clarification statuses are independent of overall request status:

-   `Pending Response`
-   `Responded`
-   `Resolved`
-   `Cancelled` only if cancellation is supported and authorized.

The assigned division can respond. Store the response, responder, and
timestamp. Preserve the original question and all follow-up responses.
DG Admin can review the response, mark the clarification resolved, or
ask a follow-up question.

A request must not be approved while required clarifications remain
unresolved. Clarification must not silently change submitted values,
unlock the entire division submission, or set the request to Draft. If a
value must be corrected, implement a separate auditable
correction/resubmission workflow only after the business rule is
defined.

## 8.6 Approve and reject

### Approve

-   Display a confirmation dialog.
-   Allow an optional approval comment.
-   Re-check server/data permissions, request state, all participating
    division submissions, and required clarification states immediately
    before saving.
-   Prevent approval if any division has not submitted or any required
    clarification is unresolved.
-   Persist the decision in the DG Admin Approval table or existing
    equivalent.
-   Record reviewer identity, decision, timestamp, and comments where
    supported.
-   Set overall request status to `Approved`.
-   Keep division contributions read-only.
-   Generate the PDF report after the decision is successfully
    persisted.

### Reject

-   Display a confirmation dialog.
-   Require a rejection reason/comment.
-   Re-check authorization and request state before saving.
-   Persist the decision, reviewer identity, timestamp, and rejection
    reason.
-   Set overall request status to `Rejected`.
-   Keep division contributions locked unless an explicitly approved
    correction/resubmission workflow is implemented.
-   Generate the PDF report after the decision is successfully
    persisted.

Prevent conflicting decisions and duplicate clicks. If a request is
already approved/rejected, do not allow a second decision to overwrite
the first. Use the supported data/security layer for final enforcement,
not only disabled buttons.

------------------------------------------------------------------------

# 9. PDF report for completed requests

## 9.1 Trigger and availability

Generate a PDF report after DG Admin records a final `Approved` or
`Rejected` decision. Do not generate the final report merely because a
division saves a draft or submits.

-   Add a `Download PDF Report` action to the completed request details
    and/or completed-request list.
-   Generate the report using persisted Dataverse data, including
    audit/clarification/comment records.
-   Do not build the PDF only from the visible React state, because the
    current page may not contain the full history.
-   If report generation fails, preserve the final decision and show a
    retryable report-generation error. Do not silently undo the decision
    or claim the PDF exists.
-   Re-generating a report must not create another approval decision. If
    reports are versioned/stored, include report generation
    timestamp/version.

## 9.2 Required PDF content

The report should be professional, branded with the appropriate DEWA
logo and green theme, and contain the following sections where data
exists.

### A. Report header

-   DEWA logo and application name.
-   Report title: `Data Division Dataset Request Report`.
-   Report generation timestamp.
-   Request ID.
-   Final request status (`Approved` or `Rejected`).

### B. Request summary

-   Request ID.
-   Dataset number/ID and dataset name.
-   Request creation date/time.
-   Request created by (name and organizational identity, where
    available).
-   Requesting business division.
-   List of all participating divisions.
-   Current/final request status.
-   Submission completion date/time, if available.
-   DG Admin decision date/time.
-   Reviewer name/identity, where available.

### C. Dataset and attribute details

For every attribute in the requested dataset:

-   Attribute name and stable identifier where available.
-   Associated division(s).
-   Each participating division's separately stored value.
-   Whether the contribution was Draft or Submitted at relevant
    lifecycle points, if audit data exists.
-   Submission status per division.
-   Submitter identity and submission timestamp where available.
-   Unit/description/classification only when present in Dataverse.

Never combine values from different divisions for a shared attribute. If
a value is blank, display a clear label such as `Blank / Not provided`;
do not fabricate a value.

### D. Request lifecycle / timeline

Include a chronological timeline of available events:

-   Request created.
-   Request ID generated.
-   Division draft saves/updates, if audit metadata is available.
-   Each division submission and its timestamp.
-   Request becoming eligible for DG Admin review.
-   Clarification requested, responded, followed up, resolved, or
    cancelled.
-   DG Admin comments, where appropriate.
-   Approval/rejection decision.
-   PDF report generation.

Do not invent events that the schema does not retain. If a detailed
event history is required but current tables only keep latest values,
report the missing audit requirement and propose an audit/event table
rather than fabricating history.

### E. Comments

Include request-level comments with author and timestamp where
available. Clearly distinguish general comments from approval/rejection
comments and clarification messages.

### F. Clarification history

For every clarification:

-   Clarification ID if available.
-   Related attribute and dataset.
-   Target division.
-   Original question.
-   Requesting DG Admin and timestamp.
-   Division response(s), responder(s), and timestamps.
-   Follow-up questions/responses.
-   Final clarification status.
-   Resolution author/time where available.

Include unresolved/cancelled clarification history too, if the request
reached a final decision under a permitted business rule. Never omit the
fact that a clarification was raised.

### G. Final decision

-   Decision: Approved or Rejected.
-   Decision-maker/reviewer.
-   Decision timestamp.
-   Approval comment or rejection reason.
-   Any decision-related comments.
-   Final status.

### H. Audit/data source note

Include a generated timestamp and identify the request by its unique ID.
Use actual persisted data only. Do not include authentication tokens,
secrets, or unnecessary personal data.

## 9.3 PDF layout and quality

-   Use readable typography, clear headings, page numbers, and
    consistent margins.
-   Use tables that wrap long dataset names, attribute names, comments,
    and clarification text without clipping.
-   Repeat table headers across pages where supported.
-   Avoid empty leading pages and content cut off at page edges.
-   Keep the DEWA logo aspect ratio and transparency correct.
-   Ensure multi-page reports remain readable.
-   Sanitize/escape untrusted user-entered comments when rendering PDF
    content.
-   Test a report with multiple divisions, shared attributes, long
    comments, and multiple clarification rounds.
-   If using a client-side PDF library already installed, inspect it and
    reuse it if suitable. Add a dependency only after checking the
    project. Do not expose privileged credentials to generate the
    report.

------------------------------------------------------------------------

# 10. UI reference and precise layout changes

The supplied screenshots are binding UI guidance for the relevant
screens.

## 10.1 Dataset table

Use a table similar to the provided dataset-list reference, with:

-   Dataset selection checkbox.
-   Dataset Name.
-   Division.
-   Classification (only if supported by schema).
-   Attributes.
-   Action/details.
-   Filter row inside the table header.

Do **not** show a separate filter panel above the table. Do **not**
include `Last Activity`. Support multi-select and a visible Create New
Request action.

## 10.2 My Requests table

-   One row per request.
-   Request ID visible.
-   Dataset and status information visible.
-   Filters in the table header.
-   No `Last Activity`.
-   No separate Drafts & Submissions navigation screen.

## 10.3 Styling

-   Follow the attached External Data Request Portal PDF/screenshot.
-   Use the correct supplied DEWA logo variant for green or white
    surfaces.
-   Use DEWA green accents rather than the reference's annotated blue
    accent.
-   Keep typography and icons consistent with the reference.
-   Avoid unnecessary blank space.
-   Use status text plus color; color alone is insufficient.
-   Do not invent an official DEWA hex value. Use the approved brand
    value if present in supplied assets/guidance; otherwise use a
    reasonable sampled approximation and document it as an
    approximation.

------------------------------------------------------------------------

# 11. Security, data integrity, and concurrency

-   Resolve identity and role from the authenticated organization
    context and `myapp_tbl_moei_userdetails`.
-   Never trust a division ID supplied by the client without
    revalidating the user's mapped division.
-   Revalidate request state and division ownership for every write.
-   A business division may write only its own editable draft values and
    its own clarification responses.
-   Only authorized DG Admins may request clarification, resolve it,
    approve, or reject.
-   Do not rely solely on hidden buttons or React checks for security.
-   Inspect Dataverse roles/ownership/row access and supported
    server-side enforcement. If direct table permissions could bypass
    the UI checks, document and implement the strongest supported
    enforcement available.
-   Use stable Dataverse IDs/lookups instead of dataset or attribute
    names as keys.
-   Prevent duplicate request headers, division submissions, attribute
    values, comments, or conflicting decisions according to the chosen
    data model.
-   Handle retries/idempotency and concurrent updates safely.
-   Preserve user input on save failures.
-   Refresh state from Dataverse after successful saves and decisions.
-   Do not log tokens, secrets, or unnecessary sensitive data.
-   Do not expose unrelated datasets or divisions.
-   Ensure the PDF report is accessible only to authorized users.

------------------------------------------------------------------------

# 12. Error, loading, and empty states

Handle and display useful messages for:

-   Identity unavailable.
-   User details not found, inactive, or mapped to multiple divisions.
-   Unknown or unauthorized role.
-   No datasets mapped to the user's division.
-   No datasets selected before Create New Request.
-   Dataset no longer eligible for request creation.
-   Duplicate active request.
-   Request creation partially failed or timed out.
-   Dataset has no mapped attributes.
-   Mapping points to missing/inactive division.
-   Duplicate or conflicting mapping rows.
-   Another division has not started, has a draft, or has not submitted.
-   Current division has already submitted.
-   Request is awaiting review or has a final decision.
-   Clarification is assigned to another division.
-   Approval is blocked by pending submissions or unresolved
    clarifications.
-   Dataverse read/write failure.
-   Concurrent update conflict.
-   PDF generation/download failure.

Never display raw tokens, connection strings, stack traces, or
privileged diagnostic information to users. Log only appropriate
developer diagnostics.

------------------------------------------------------------------------

# 13. Acceptance criteria and tests

## 13.1 Identity and catalogue

1.  A signed-in user resolves through `myapp_tbl_moei_userdetails` to
    exactly one active division and role.
2.  A user with no mapping or multiple conflicting mappings cannot see
    datasets or requests.
3.  The dataset catalogue shows only datasets mapped to the current
    division.
4.  An unrelated division cannot be used to gain access by changing a
    filter or request ID.
5.  User authentication/role resolution does not depend on
    `myapp_tbl_moei_businessdivision`.

## 13.2 Dataset selection and request creation

6.  User can select one dataset and create a request.
7.  User can multi-select several datasets and initiate requests in one
    action.
8.  Under the current working assumption, each selected dataset receives
    its own unique Request ID.
9.  The generated Request ID is shown after creation and appears in My
    Requests.
10. Opening a dataset without clicking Create New Request does not
    create a request.
11. Retrying a timed-out creation does not create duplicate requests.
12. Filters appear in the table header row, not in a separate panel
    above.
13. The table supports multi-select.
14. `Last Activity` is absent.
15. There is no separate Drafts & Submissions navigation screen.

## 13.3 Attribute ownership and shared values

16. Dataset details show only attributes mapped to the selected dataset.
17. Only divisions associated with at least one attribute of the
    selected dataset are shown.
18. A division can edit only its own contribution.
19. A shared attribute has separate stored values for each mapped
    division.
20. Values entered by one participating division are visible to the
    other participating divisions even while Draft.
21. Other divisions' draft values are visible but read-only.
22. An unrelated division does not appear in the request or submission
    gate.

## 13.4 Draft and submission

23. Save Draft persists only the current division's values.
24. Reopening a draft restores its values.
25. Blank values are permitted unless an explicit validation rule
    exists.
26. Submitting one division locks only that division's values.
27. Other divisions' drafts remain editable by their respective owners.
28. Overall status stays In Progress until all participating divisions
    submit.
29. Only when all participating divisions submit and required
    clarifications are resolved does the request become Pending DG Admin
    Review.
30. A submitted contribution cannot be changed by direct invocation of
    an available write path.

## 13.5 Clarification and approval

31. DG Admin can add multiple comments without overwriting prior
    comments.
32. DG Admin can request clarification for a specific attribute and
    target division.
33. For shared attributes, clarification is associated with the correct
    division contribution.
34. The assigned division can view and respond to the clarification;
    another division cannot respond to it.
35. Clarification questions, responses, follow-ups, authors, timestamps,
    and statuses persist.
36. Required unresolved clarifications block approval.
37. Clarification does not automatically unlock submitted values.
38. Only authorized DG Admin users can approve/reject.
39. Approval/rejection records the decision, reviewer, timestamp, and
    relevant comments/reason.
40. Final decisions cannot be silently overwritten by duplicate actions.

## 13.6 PDF report

41. No final PDF is presented as complete before the request has a
    persisted final decision.
42. After approval or rejection, DG Admin can download the PDF.
43. PDF includes Request ID, creation details, creator, dataset,
    attributes, separate values per division, submission statuses,
    comments, clarification history, final decision, reviewer, and
    timestamps where data exists.
44. The PDF does not fabricate missing audit events or values.
45. Long comments and multiple attributes/divisions render without
    clipping.
46. The PDF has a clear DEWA-aligned header, page numbers, readable
    tables, and no unintended blank leading pages.
47. Report-generation failure is visible and retryable without undoing
    the final decision.

## 13.7 Build and quality

48. Existing project build passes.
49. Lint and automated tests pass.
50. Tests cover the current and new workflows.
51. Existing Power Apps Code App integration is preserved.
52. No hardcoded production datasets, divisions, values, users, or roles
    remain.
53. The final response accurately states whether deployment/push was
    performed and provides the actual command result.

------------------------------------------------------------------------

# 14. Required test scenarios

### Scenario A --- Dataset catalogue and request creation

A Generation user sees only datasets mapped to Generation. They select
two datasets and click Create New Request. Two requests are created
under the current assumption, each with a unique Request ID displayed to
the user. Opening a dataset without creating a request must not create
one.

### Scenario B --- Split attributes

Dataset A has four attributes. Attributes 1 and 2 belong to Generation;
attributes 3 and 4 belong to BD&E. Generation edits only its own
attributes and views BD&E's values read-only. The overall request stays
In Progress until both divisions submit.

### Scenario C --- Shared attribute with drafts visible

`Natural Gas` belongs to Generation and BD&E. Generation saves `100` as
Draft. BD&E can immediately view `100`, but cannot edit it. BD&E saves
`200` as Draft; Generation can view `200`, but cannot edit it. The two
values never overwrite each other.

### Scenario D --- Multiple participating divisions

A dataset is mapped to three divisions. Two submit; the third remains
Draft. The request must remain In Progress and must not enter DG Admin's
eligible review queue.

### Scenario E --- Clarification for shared attribute

DG Admin requests clarification on the BD&E value for a shared
attribute. The clarification is linked to BD&E's contribution only.
Generation cannot respond on BD&E's behalf. The original value and all
messages remain in history.

### Scenario F --- Pending clarification

A request has all divisions submitted, but a required clarification is
Pending Response or Responded but not Resolved. Approval must be blocked
until the clarification is resolved.

### Scenario G --- Final decision and PDF

DG Admin approves a fully submitted request. The decision is persisted,
the request becomes read-only to divisions, and the PDF contains the
request creation details, every division's values, comments,
clarifications/responses, and the final decision with reviewer and
timestamp. Repeat with a rejected request and ensure the rejection
reason is included.

### Scenario H --- Security

A non-admin attempts to open the DG Admin route or invoke an approval
action directly. The action must be denied by the actual
authorization/data layer, not merely hidden in the UI.

### Scenario I --- Data/schema failure

A required column or relationship is missing. The app must show a useful
setup error, must not fabricate data, and Claude must report the exact
schema change needed.

------------------------------------------------------------------------

# 15. Open assumptions to flag, not silently invent

1.  **Multi-select semantics:** current working assumption is one
    request per selected dataset. Confirm if the business expects one
    request ID across multiple selected datasets.
2.  **New request cycles:** confirm whether a dataset can have another
    request after an earlier one is approved/rejected and whether a
    reporting period/year is part of request identity.
3.  **Request table identity:** determine whether
    `myapp_tbl_moei_request` and `tbl_MOEI_requests` are the same table.
4.  **Request data model:** determine whether the current table
    represents a header, division submission, or one attribute-value
    row.
5.  **User details schema:** confirm the real columns for user identity,
    division assignment, active status, and role in
    `myapp_tbl_moei_userdetails`.
6.  **DG Admin authorization:** confirm the approved source/role value
    and Dataverse permission design.
7.  **Correction after clarification:** current rule is that submitted
    values remain locked. If a value correction is needed, the business
    must approve an auditable correction/resubmission workflow.
8.  **Rejected requests:** resubmission/unlocking behavior remains
    undecided; do not invent it.
9.  **Audit history:** if the current tables only preserve latest values
    and not past draft saves/status transitions, confirm whether a full
    event log is required. The PDF must include all events the system
    actually retains; it must not fabricate historical events.
10. **PDF storage:** determine whether the PDF should be generated for
    direct download only or stored in an approved secure file location.
11. **Notifications:** emails are not mandatory unless a trigger,
    recipients, and content are confirmed.
12. **Classification/filter field:** use the Classification
    column/filter only if a real field exists in Dataverse.
13. **Official DEWA color:** use approved brand codes if available;
    otherwise document any visual approximation.

------------------------------------------------------------------------

# 16. Implementation phases

## Phase 1 --- Inspect and map

-   Read existing code and configuration.
-   Inspect all connected Dataverse schemas and source identifiers.
-   Resolve the request-table discrepancy.
-   Confirm user details and DG Admin role fields.
-   Determine whether request headers, division submissions, attribute
    values, comments, clarifications, approval records, and report
    metadata can be represented by existing tables.
-   Report exact blockers/schema changes before writing production data.

## Phase 2 --- Identity and data services

-   Implement signed-in identity resolution through the supported Code
    App mechanism.
-   Resolve exactly one active user, division, and role using
    `myapp_tbl_moei_userdetails`.
-   Build typed data-access services based on actual schema.
-   Add safe loading/error handling and authorization checks.

## Phase 3 --- Business division catalogue and request list

-   Build Dataset Catalogue with row multi-select, filters inside table
    headers, no Last Activity column, and Create New Request.
-   Create unique Request IDs using a supported safe mechanism.
-   Build My Requests with one row per request, header filters,
    statuses, and actions.
-   Do not add a separate Drafts & Submissions page.

## Phase 4 --- Request details, drafts, and submissions

-   Show dataset attributes and relevant divisions.
-   Display values for all participating divisions, including Draft
    values.
-   Keep other divisions' values read-only.
-   Save/resume division-specific drafts.
-   Submit and lock only the current division's portion.
-   Calculate overall status from all participating divisions.

## Phase 5 --- DG Admin comments, clarification, and decisions

-   Build the protected review queue and consolidated request detail.
-   Implement persistent comments and clarification history.
-   Implement division responses and resolution.
-   Implement approval/rejection with revalidation and audit metadata.

## Phase 6 --- PDF reporting

-   Generate PDF only after a persisted final decision.
-   Include the complete request, attribute/division values, lifecycle
    events available, comments, clarification history, and final
    decision.
-   Test multi-page rendering and download behavior.

## Phase 7 --- Quality and deployment

-   Run build, lint, and tests.
-   Fix regressions.
-   Test against actual Dataverse data wherever permissions allow.
-   Document any remaining security configuration or schema changes.
-   Push only when ready and only report success if the command confirms
    it.

------------------------------------------------------------------------

# 17. Final report Claude must provide

After implementing, report:

1.  Screens/workflows implemented.
2.  Actual Dataverse table logical names and fields used.
3.  Whether any schema changes were needed and why.
4.  How Request IDs are generated.
5.  How multi-select request creation behaves.
6.  How the user's division and role are resolved.
7.  How Draft values are shared read-only with other participating
    divisions.
8.  How the submission gate is calculated.
9.  How comments and attribute-level clarification history are stored.
10. How approval/rejection and final PDF generation work.
11. Build, lint, and test results.
12. Whether Power Apps push was performed, with the actual result.
13. Remaining assumptions, permissions, schema changes, and business
    decisions.

Do not claim production security based only on frontend controls. State
clearly what Dataverse/server-side configuration is still required.

------------------------------------------------------------------------

# 18. Final execution instruction

**Read this entire document and inspect the existing project before
coding. Then implement the requirements in the current project.** Do not
stop after producing a plan. Reuse existing connected Dataverse tables
where possible, do not invent schema names, preserve working
functionality, and flag the assumptions in Section 15. Do not deploy
until the build and tests pass.

------------------------------------------------------------------------

# 17. Latest requirement changes --- 16 October 2026 (authoritative)

This section records the latest business-division requirements and **overrides conflicting earlier wording anywhere in this document**. Claude Code must implement these rules and update any tests, components, routing, and data queries accordingly.

## 17.1 Business-division navigation

The business-division sidebar must contain:

1. **Dashboard** --- KPI cards and charts for the current division's request statuses, plus approved/owned dataset metrics.
2. **My Requests** --- all requests relevant to the current division, with filters inside the table header and a `Create New Request` button.
3. **My Datasets** --- only datasets requested by this division and approved by DG Admin.

Do not show a standalone `Dataset Catalogue` screen or navigation item. Do not show a separate `Drafts & Submissions` screen. The create-request experience is a modal/dialog opened from My Requests. Request details may be a separate detail route opened from a request row.

## 17.2 Create request and attribute selection

The Create New Request modal must:

- Show only datasets that have one or more attributes mapped to the logged-in division.
- Support dataset search and multi-selection.
- Expand each selected dataset to show selectable/relevant attributes.
- Show only attributes mapped to the logged-in division, including attributes shared with other divisions.
- Never show an attribute that belongs exclusively to another division in this modal or in the business division's attribute-entry screen.
- Generate a separate unique request ID per selected dataset, following the existing working assumption, unless the existing approved data model explicitly establishes a different rule.
- Create no request until the user confirms the modal.
- Display the generated request IDs and dataset names after Dataverse confirms creation.

## 17.3 Attribute ownership versus shared visibility

The attribute-to-division mapping is the authority. For a logged-in division `D`:

- **Owned attribute:** mapped only to `D`. Show it to `D`; do not show it to unrelated divisions.
- **Shared attribute:** mapped to `D` and at least one other division. Show it to every division explicitly mapped to it.
- **Other-division-only attribute:** not mapped to `D`. Do not show its attribute row or value to `D`, even if it belongs to the same dataset/request.

For shared attributes, maintain a separate value per division. A value saved by Generation for `Natural Gas`, for example, must be visible to BD&E if and only if the mapping confirms that Natural Gas is shared with BD&E. Draft values must be visible to all divisions mapped to that same shared attribute, but read-only to everyone except the division that owns the value. A division may never edit another division's value.

This supersedes earlier wording that business division users should see **all attributes belonging to the dataset** or all participating divisions' values for every attribute. Cross-division visibility is limited to attributes that are explicitly shared with the logged-in division.

## 17.4 Dashboard and My Datasets rules

- Dashboard charts and KPI cards must be populated from live Dataverse data and count unique request IDs/datasets, not attribute rows.
- Include request status counts and an approved/owned dataset count. Charts must be scoped to the logged-in division.
- My Datasets must contain only datasets for which this division has a request with final status `Approved`.
- A dataset available by mapping, selected in a modal, saved as Draft, submitted, or pending DG Admin review is not yet an owned/approved dataset.
- If multiple approved requests point to the same dataset, show/count the dataset once unless the confirmed reporting-cycle model requires separate versions.

## 17.5 My Requests table and design

- My Requests is the main request-management screen.
- Keep request search/status filters inside the table header/filter row rather than a separate panel above the table.
- Remove `Last Activity`.
- Provide a visible `Create New Request` button that opens the modal.
- Keep the existing DEWA green styling, responsive layout, accessible controls, and clear loading/error/empty states.

## 17.6 Required validation scenarios

1. Generation sees a dataset because Generation owns or shares at least one attribute in it.
2. In the request modal, Generation sees Generation-owned attributes and shared attributes mapped to Generation, but does not see BD&E-only attributes such as Solar Thermal or Solar PV when those are mapped only to BD&E.
3. If Natural Gas is mapped to both Generation and BD&E, both divisions see the attribute and their own separate values.
4. Generation saves its Natural Gas value as Draft; BD&E can see that value while Draft but cannot edit it. BD&E's own Natural Gas value remains separate and can be edited by BD&E while its contribution is Draft.
5. A draft or submitted value for an attribute exclusive to another division is not exposed to the logged-in division.
6. Dashboard charts reflect the current division's real request statuses.
7. My Datasets shows only approved datasets requested by the current division, not every mapped dataset.
8. Clicking Create New Request from My Requests opens the modal and does not navigate to a Dataset Catalogue page.
9. Cancelling the modal creates no records. Confirming creates the request(s) and shows the actual generated IDs only after Dataverse confirms success.


Admin Centre — Dataset, Attribute and User Management
1. Purpose
The Admin Centre provides authorized administrators with a centralized interface to manage dataset definitions, attribute metadata, business-division mappings, and application user records.
The Admin Centre is separate from the DG Admin review module. The Admin and DG Admin roles must remain distinct.
2. Role-Based Access
* Only authenticated users mapped to UserRole = Admin in myapp_tbl_moei_userdetails may access the Admin Centre.
* DG Admin retains the existing request-review and approval functionality.
* BusinessDivision users cannot access administrative screens or perform administrative write operations.
* Authorization must be enforced for data operations, not only through UI navigation.
3. Dataverse Tables
3.1 Dataset reference table
myapp_tbl_moei_datasetwithattributes
Stores dataset-level reference information and the attribute representation supported by its current schema.
The existing table includes fields representing dataset names/numbers and fixed attribute columns such as Attribute 1, Attribute 2, Attribute 3, and subsequent columns.
The application must inspect and respect the actual schema. It must not assume unlimited attribute capacity when the reference table uses a fixed number of columns.
3.2 Dataset and business-division mapping table
myapp_tbl_moei_datasetandbusinessmap
Stores dataset-to-attribute metadata and business-division mappings. The existing table includes dataset information, attribute name and description, unit, business division, and classification fields.
This table is the authoritative source for determining which divisions own or share individual attributes.
3.3 User details table
myapp_tbl_moei_userdetails
Stores application user mappings, including fields such as UserName, UserID, UserMailID, UserRole, and UserDesignation.
The actual logical names and column types must be verified before implementation.
4. Admin Centre Navigation
The Admin Centre contains two sections:
1. Dataset & Attribute Management
2. User Management
The existing DG Admin dashboard, review queue, clarification workflow, approval/rejection workflow, and PDF reporting must remain separate and functional.
5. Dataset & Attribute Management
5.1 Dataset list
Administrators can view and search existing datasets. The list should display dataset identity, name, attribute count, mapped divisions, classification where available, and permitted actions.
Dataset rows must be deduplicated when the mapping table contains multiple attribute records for the same dataset.
5.2 Dataset creation
Administrators can create a dataset using a form that captures the dataset-level metadata supported by the existing schema.
The form must provide an Add Attribute action. Each action appends a new independent attribute form, allowing administrators to enter multiple attributes in a single workflow.
5.3 Attribute fields
Each attribute must capture the applicable fields supported by the schema:
* Attribute name
* Attribute description
* Unit
* Business division mapping
* Attribute classification
* Other existing attribute-level metadata, where applicable
Attributes can be added and removed before saving, subject to validation rules.
5.4 Business-division mapping
The form must show all valid business divisions from the authoritative source.
An attribute can belong to one division or be shared by multiple divisions when the data model supports it. Each participating division must be explicitly mapped.
Shared attributes must be visible to every mapped division. Attributes exclusively mapped to another division must not be exposed to an unrelated division.
5.5 Saving dataset and attribute records
Dataset creation must maintain consistency between the reference table and the mapping table.
* Create the dataset reference record.
* Save the dataset's attribute metadata and business-division mappings.
* Preserve the dataset identifier relationship between the records.
* Validate all required fields before writing.
* Prevent duplicate datasets and duplicate mappings according to the actual business keys.
* Handle partial failures safely and report unsuccessful writes.
The application must not claim that both tables were successfully updated unless the required writes are confirmed.
5.6 Editing existing datasets
Administrators can view and edit existing dataset details and eligible attribute metadata.
Changes must not silently destroy historical request values, invalidate approved submissions, or break existing mappings. Attributes already used by requests must be protected by appropriate validation and historical-data safeguards.
5.7 Dataset visibility after creation
New datasets and mappings must be available to the existing Business Division request workflow.
Attribute visibility must follow the division mappings. Request creation must continue to support separate values for each participating division and must not grant unrelated divisions access.
6. User Management
6.1 User list
Administrators can view and search user records from myapp_tbl_moei_userdetails.
The list should show UserName, UserID, UserMailID, UserRole, UserDesignation, and other relevant existing fields.
6.2 Add user
Administrators can create a user mapping using the fields supported by the existing schema, including:
* UserName
* UserID
* UserMailID
* UserRole
* UserDesignation
When adding a BusinessDivision user, the administrator selects a valid business division from the available division list.
Duplicate identifiers and conflicting account mappings must be validated.
6.3 Edit user
Administrators can update eligible user details and role/division assignments.
Changing a user's division must not transfer ownership of historical requests, overwrite contributions, or bypass submission and approval locks.
The application continues to use the platform's authenticated identity. The user-details table provides role and division mapping; it does not replace Microsoft 365 authentication.
6.4 Administrative safeguards
The application must prevent unauthorized role elevation and accidental removal of the last authorized administrator, where the available authorization model permits those safeguards.
7. UI Requirements
* Follow the existing DEWA-branded green theme.
* Use responsive tables and forms.
* Provide dynamic attribute entry.
* Display validation and save status clearly.
* Include loading, empty, and error states.
* Confirm destructive actions.
* Preserve the existing application navigation and design conventions.
8. Validation and Acceptance Criteria
The feature is considered complete when:
1. Only authorized Admin users can access and operate the Admin Centre.
2. Administrators can view and search existing datasets.
3. Administrators can create datasets and dynamically add multiple attributes.
4. Each attribute can be mapped to the appropriate business divisions.
5. Dataset reference and mapping records are saved consistently.
6. New mappings are reflected in the Business Division workflow.
7. Shared attributes appear for every mapped division, with separate division-specific values.
8. Administrators can add and edit user mappings.
9. Existing DG Admin and Business Division workflows remain functional.
10. Build, lint, and relevant automated tests pass.
9. Schema Limitations and Assumptions
The existing dataset reference table appears to represent attributes through fixed columns. This may limit the number of attributes that can be stored in that table.
Before implementation, inspect its actual columns and determine how the application can support dynamic attribute entry without losing data. If the schema cannot represent the requested behavior, document the limitation and recommend a scalable normalized data model rather than silently imposing a maximum or creating columns automatically.
The exact mandatory fields, choice values, relationship names, duplicate-detection keys, and deletion rules must be derived from the existing Dataverse schema and confirmed business rules.



