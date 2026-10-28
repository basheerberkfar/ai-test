---
id: STORY-001
title: Create New Patient
priority: High
appUrl: http://localhost:5173
role: Therapist
covers: apps/demo-app/src/pages/PatientsPage.tsx, apps/demo-app/src/pages/PatientFormPage.tsx, apps/demo-app/src/pages/PatientDetailPage.tsx, apps/demo-app/src/pages/LoginPage.tsx, apps/demo-app/src/components/, apps/demo-app/src/hooks.ts, apps/demo-app/src/api.ts, apps/demo-app/src/auth.tsx, apps/shared/, server/api/demo.ts, server/database/demo-db.ts
---

## Description

As a therapist, I want to create a new patient so that I can manage their treatment information.

## Acceptance Criteria

1. The therapist can access the patient creation form.
2. Required fields must be validated.
3. Valid patient data must be saved.
4. The new patient must appear in the patient list.
5. The saved data must remain available after refreshing the page.

## Happy Path

1. Log in as Therapist.
2. Open Patients.
3. Click Add Patient.
4. Complete the required fields.
5. Submit the form.
6. Verify successful creation.
7. Return to the patients list.
8. Verify that the patient exists.
9. Refresh the page.
10. Verify that the patient still exists.
