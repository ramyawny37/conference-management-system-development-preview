# Conference Management System Engineering Rules

These rules apply to every future task in this workspace.

- Do not change application behavior unless explicitly requested.
- Do not redesign the UI.
- Do not change Arabic text.
- Do not rename public global functions unless required.
- Do not convert the application to ES modules.
- Always preserve backward compatibility.
- Always analyze dependencies before moving functions.
- Never delete duplicate functions until proving they are redundant.
- Always modify active runtime files only.
- Ignore `Releases`, ZIP files, and archived copies.
- Do not run the browser or automated UI tests.

After every edit, perform:

- Static syntax validation.
- Duplicate function scan.
- Undefined reference scan.
- Dependency verification.
