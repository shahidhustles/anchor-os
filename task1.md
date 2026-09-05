# Anchor OS — Task 1 artifact workflow

## Goal

Build the first complete Anchor OS artifact workflow.

A user should be able to open a new chat, ask for a Word document or Excel workbook, watch the artifact appear in the UI while the agent works, open the finished file in the side panel, and edit the same file through follow-up chat messages.

Use one default model for now. Do not build the model router or OCR yet.

## Current state

Anchor OS already has:

- EVE installed and working
- assistant-ui installed and working
- new chat/thread creation
- normal chat with the model
- reasoning display
- working tool calls
- working webpage rendering tool

Keep this setup. Extend it only for workspace-backed artifacts.

## Core architecture

Each new chat/thread gets its own EVE session and workspace.

The workspace starts empty from the user's point of view, but the sandbox already contains the runtimes and document dependencies the agent needs.

The relationship should remain:

`assistant-ui thread = EVE session = one workspace`

Files created during a thread stay available to later turns in that same thread.

For this version, do not add project/folder selection. That can come later.

## Sandbox

Use a preconfigured local EVE sandbox rather than installing packages during a task.

The sandbox should already have the dependencies required by the DOCX and XLSX skills, including the required Python and Node runtimes and document-processing utilities.

The agent should create and modify artifacts through EVE's existing workspace access and shell execution. Do not create separate `create_docx`, `create_xlsx`, `edit_docx`, or `edit_xlsx` tools.

The artifact is a real file in the workspace.

For the local-only prototype, the sandbox must not depend on downloading packages while a task is running.

## Skills

Use the official Anthropic skills as the starting point. Do not rewrite their instructions inside Anchor OS before the first end-to-end flow works.

DOCX skill:

https://github.com/anthropics/skills/blob/main/skills/docx/

XLSX skill:

https://github.com/anthropics/skills/tree/main/skills/xlsx

you can also see the skills in the skills folder of agent/skills.

When the user requests a Word document, the agent should load the DOCX skill before doing the document work.

When the user requests a spreadsheet, the agent should load the XLSX skill before doing the spreadsheet work.

We can personalize these skills for Anchor OS later.

## Creation flow

### Word

1. User asks for a Word document.
2. The agent loads the DOCX skill.
3. The agent creates any temporary scripts or source files it needs inside the workspace.
4. The agent generates the actual `.docx` file inside the workspace.
5. assistant-ui shows an artifact card while the file is being produced.
6. When the file is ready, the artifact card becomes the entry point to the completed document.
7. Opening the artifact shows the document in the side panel.

### Excel

1. User asks for an Excel workbook.
2. The agent loads the XLSX skill.
3. The agent creates or runs the required workspace scripts.
4. The agent generates the actual `.xlsx` file inside the workspace.
5. assistant-ui shows an artifact card while the workbook is being produced.
6. When the workbook is ready, opening the artifact shows it in the side panel.

## Artifact card behavior

Use assistant-ui's artifact pattern rather than creating a separate artifact system.

The card should represent a real workspace file.

While the agent is creating or updating an artifact, show useful live state such as:

- file name
- file type
- creating or editing state
- word count for document content when available
- other lightweight progress information that can be derived reliably

Do not pretend a partially written DOCX or XLSX is already renderable.

Text or Markdown content can stream directly when available. Binary Office files should show live creation or editing state, then switch to the rendered file once the file is valid.

## Side panel

Support at least these renderers for the prototype:

- DOCX
- XLSX
- Markdown if useful for debugging or intermediate files

Clicking an artifact card opens the matching file in the side panel.

The side panel should read the latest version from the current thread's workspace.

The user should not need to download the file just to inspect it.

## Editing flow

Editing is required for the first version.

Example:

1. User creates `Approval_Note.docx`.
2. The document opens in the side panel.
3. User says, "Make the conclusion shorter and add a findings table."
4. The same EVE session handles the request.
5. The agent loads or reuses the DOCX skill.
6. The agent reads and modifies the existing workspace artifact using the workflow defined by the skill.
7. The artifact card changes to an editing state.
8. The existing file is updated.
9. The side panel refreshes to the new version.

The same behavior should work for XLSX follow-up edits.

Do not create a new artifact when the user's instruction clearly refers to the existing file. Update the existing workspace file unless the user asks for a copy or a new version.

## Artifact identity

Treat the workspace path as the artifact's stable identity inside a thread.

If the agent updates the same path:

- update the existing artifact card
- refresh the existing side-panel view
- do not create duplicate artifacts

If the agent creates a new path, create a new artifact entry.

## Definition of done

The task is complete only when all of these work from the Anchor OS UI:

1. Start a new chat.
2. Ask for a DOCX.
3. The agent loads the DOCX skill and creates a real `.docx` in that thread's workspace.
4. An artifact card shows creation progress.
5. The finished DOCX opens in the side panel.
6. Ask for a change in chat.
7. The same DOCX is edited and the side panel refreshes.
8. Repeat the same create, preview, and edit flow for XLSX.
9. Start another chat and confirm it gets a separate workspace.
10. Artifact creation does not require package downloads during the task.

