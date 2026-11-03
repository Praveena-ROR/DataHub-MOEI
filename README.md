# DataHub MOEI – Yearly Dataset Integration
## Overview

DataHub MOEI is a Microsoft Power Apps Code App designed to streamline dataset requests, business-division data collection, and centralized data governance.

The application enables business divisions to discover relevant datasets, submit attribute-level data, track request progress, and collaborate with other participating divisions. DG Admin manages the review and approval process, including clarifications, final decisions, and audit report generation.

The application uses Microsoft Dataverse as its data platform and provides a structured, secure, and transparent approach to managing dataset requests.

## Key Features

### Business Division Portal
- Division-specific dataset discovery.
- Search, filter, and select datasets.
- Create and track dataset requests.
- Save drafts and resume data entry.
- Submit division-specific attribute values.
- View participating divisions' shared attribute values.
- Respond to assigned clarifications.
- Track request statuses and approved datasets.

### DG Admin Portal
- Centralized request review dashboard.
- View requests submitted by business divisions.
- Review dataset attributes and division contributions.
- Request clarifications for specific attributes.
- Manage clarification responses and comments.
- Approve or reject eligible requests.
- Generate downloadable PDF audit reports.

### Data Governance
- Role-based access control.
- Division-specific dataset and attribute visibility.
- Independent attribute values for participating divisions.
- Draft and submission status management.
- Request lifecycle tracking.
- Audit history and approval records.

## Technology Stack

| Technology | Purpose |
|---|---|
| React | Frontend user interface |
| TypeScript | Type-safe application development |
| Vite | Development server and build tooling |
| Microsoft Power Apps Code Apps | Application platform |
| Microsoft Dataverse | Data storage and management |
| Power Platform | Application integration and deployment |
| PDF Generation | Request reports and audit documentation |

## Application Workflow

1. A user signs in through the organization's authenticated Power Apps environment.
2. The application identifies the user's business division and authorized role.
3. The business division discovers relevant datasets and creates a request.
4. Participating divisions enter and submit their respective attribute values.
5. The request becomes eligible for DG Admin review after all required divisions submit.
6. DG Admin reviews the request, manages clarifications, and approves or rejects it.
7. A PDF report is generated containing the request details and available audit history.

## Application Architecture

The application follows a frontend and data-platform architecture.

- **Frontend:** React and TypeScript provide the user interface and application workflows.
- **Application Platform:** Power Apps Code Apps provides the application environment and supported data-source integration.
- **Data Layer:** Microsoft Dataverse stores datasets, attribute mappings, user details, requests, submissions, and approval records.
- **Governance Layer:** Role-based authorization and workflow rules control access, submissions, and administrative decisions.

## Project Structure

The project is developed using an existing React, TypeScript, and Vite codebase integrated with Microsoft Power Apps Code Apps.

The application uses connected Dataverse data sources rather than hardcoded production datasets, divisions, users, or request information.

## Development Setup

### Prerequisites
- Node.js and npm
- Visual Studio Code
- Git
- Access to the configured Microsoft Power Platform environment
- Required Dataverse data-source connections and permissions

### Run Locally

Clone the repository:

```bash
git clone <repository-url>
```

Navigate to the project directory:

```bash
cd Datahub-MOEI
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Use the existing Power Apps Code App configuration and connected data sources when developing or deploying the application.

## Data Management

Microsoft Dataverse is used as the application's primary data platform.

The application integrates dataset and attribute mappings, business-division reference data, user details, request records, and DG Admin approval information.

User access and data visibility are determined by the authenticated user's authorized division and role.

## Project Objective

To provide a centralized and governed platform for business divisions to request datasets, contribute data, track submissions, and collaborate with DG Admin through a structured approval process.

---

**Project:** DataHub MOEI

**Application Type:** Microsoft Power Apps Code App

**Frontend:** React + TypeScript + Vite

**Data Platform:** Microsoft Dataverse
