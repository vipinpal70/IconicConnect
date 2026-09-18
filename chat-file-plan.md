# Case Chat — Allow Everyone to Send Files Plan

**Status: DRAFT — awaiting approval. No code has been changed for this plan.**

Bug reported: on `admin/cases/[id]` (and the ops portal `/cases/[id]`), there is no way to
attach a photo or document in Case Chat — only text messages can be sent. On
`client/cases/[id]` the same chat component lets the lab attach files. This plan makes file
attachments work for **every** role that can already access a case's chat, not just the
client side.

---

## 1. Why this happens today (grounded in current code)

Both the admin case page and the client case page render the **same** components —
there is no duplicated chat implementation to fix in two places:

- [src/app/admin/(dashboard)/cases/[id]/page.tsx](src/app/admin/(dashboard)/cases/[id]/page.tsx) → `<CaseDetailView chatSide="admin" />`
- [src/app/(ops)/cases/[id]/page.tsx](src/app/(ops)/cases/[id]/page.tsx) → `<CaseDetailView chatSide="admin" />` (designer/QC/account-manager/consultant portal)
- [src/app/client/(dashboard)/cases/[id]/page.tsx](src/app/client/(dashboard)/cases/[id]/page.tsx) → `<CaseDetailView chatSide="lab" />`
- [src/components/CaseDetailView.tsx:836-842](src/components/CaseDetailView.tsx#L836-L842) renders `<CaseChat side={chatSide} .../>` for all three.

`side` is a two-way bucket, not a literal role:
- `"lab"` = `client` / `subuser`
- `"admin"` = every `admin_portal` role (`admin`, `qc`, `account_manager`, `designer`,
  `consultant` — see [src/lib/auth/role.ts:3](src/lib/auth/role.ts#L3))

The restriction to file-only-on-`"lab"` is **intentional, hardcoded, in two places**:

1. **Frontend UI gate** — [src/components/CaseChat.tsx:329-349](src/components/CaseChat.tsx#L329-L349): the attach
   button + hidden `<input type="file">` are only rendered `{side === "lab" && (...)}`. Admin/ops
   users never even see a paperclip icon.
2. **Frontend handler guard** — [src/components/CaseChat.tsx:122-129](src/components/CaseChat.tsx#L122-L129): even if
   triggered another way, `handleFileChange` immediately toasts *"Admins and QC operators can
   only send text messages."* and returns.
3. **Backend role check** — [src/app/api/cases/[id]/chat/route.ts:110-121](src/app/api/cases/[id]/chat/route.ts#L110-L121):
   `POST /api/cases/:id/chat` rejects with 403 *"Forbidden: Admins, designers, and QC leads
   cannot send media files."* whenever `fileUrl` is present and `profile.role` isn't `client`/`subuser`.
   Comment on the line above literally says `// 2. Role restriction check: ONLY clients and
   subusers can upload files!`.

Everything else in the pipeline is already role-agnostic and needs **no change**:

- `chat_messages.fileUrl/fileName/fileType/fileSize` columns ([src/db/schema/chat.ts:5-19](src/db/schema/chat.ts#L5-L19))
  aren't restricted by role.
- The multipart upload endpoint the browser calls, `/api/cases/upload` (`init`/`sign`/`complete`),
  already resolves a valid client/lab context for `admin_portal` roles too —
  [src/app/api/cases/upload/route.ts:44-45](src/app/api/cases/upload/route.ts#L44-L45) via
  `isValidRoleForType('admin_portal', profile.role)`. Admin/QC/designer file uploads already work
  at the storage layer; they just never reach it because of the two gates above.
- Case-chat **access** itself (`canAccessCaseChat`, [src/lib/chat.ts:14-27](src/lib/chat.ts#L14-L27)) already
  allows admin, the case's own designer/qc/accountManager, and the case's client/subuser — this
  plan does not touch who can open the chat, only who can attach a file once inside it.

---

## 2. What changes

### 2.1 Frontend — [src/components/CaseChat.tsx](src/components/CaseChat.tsx)

- Remove the `side === "lab"` condition around the attach button + `<input type="file">`
  (lines 329-349) so it renders for both sides whenever the chat isn't `disabled`/`forbidden`.
- Remove the `if (side !== "lab") { toast.error(...); return }` guard at the top of
  `handleFileChange` (lines 126-129) — access is already governed by `disabled`/`forbidden`
  upstream, so this check is now redundant rather than protective.
- The `side` prop stays (still drives message-bubble alignment/left-right layout), it just stops
  gating file attachment.

### 2.2 Backend — [src/app/api/cases/[id]/chat/route.ts](src/app/api/cases/[id]/chat/route.ts)

- Delete the role-restriction block (lines 110-121's `isClientRole` check and its 403). Once
  removed, any profile that already passed `canAccessCaseChat` earlier in the same handler
  (line 94) — and only such profiles — may attach a file. The existing 500MB size check stays,
  just no longer nested only inside the "client role" branch.
- No other change to the route: text-only messages, notifications
  (`resolveCaseChatParticipantIds`), and the `client_reject` chat-lock (line 98-100) all already
  apply uniformly regardless of role.

### 2.3 No schema, storage, or permission-model changes needed
Confirmed above — the DB columns and the R2 multipart upload route already accept any
`admin_portal` role. This is purely removing two redundant application-level blocks.

---

## 3. Pre-existing, unrelated bug worth flagging (optional fix, not required for this task)

[src/components/CaseChat.tsx:270](src/components/CaseChat.tsx#L270):
```ts
const isAdminColumn = ["admin", "qc", "designer"].includes(m.senderRole)
```
This decides which side of the chat a message bubble renders on. It omits `account_manager` and
`consultant`, even though both are `admin_portal` roles that can already open case chat today
(via `canAccessCaseChat`'s designer/qc/accountManager branch) and send **text** messages. If an
account manager sends a message today, it likely renders as if it were a client message. This is
unrelated to the file-attachment bug and pre-dates this plan — flagging it here since "let
everyone send files" makes it more likely those roles are actively using the chat. Recommend
fixing in the same pass by aligning this list with the `admin_portal` role list in
[src/lib/auth/role.ts:3](src/lib/auth/role.ts#L3) (`admin`, `qc`, `account_manager`, `designer`,
`consultant`) — but this is a call for you to confirm before I touch it, since it's not what was
reported.

---

## 4. Manual test plan (after implementing)

1. As `client`/`subuser` on `client/cases/[id]`: confirm attach button still works (regression
   check — behavior must not change for the side that already worked).
2. As `admin` on `admin/cases/[id]`: attach an image, then a `.pdf`, then a `.docx` — confirm
   each appears in the thread with the correct preview (image inline, doc as a download card),
   and that the client side sees it appear on next poll (chat polls every 8s,
   [src/components/CaseChat.tsx:72](src/components/CaseChat.tsx#L72)).
3. As `qc`/`designer` on the ops portal `/cases/[id]`: same attach flow.
4. Confirm the `client_reject` case-status lock still disables the entire input row (button +
   text + send) for every role — [src/components/CaseChat.tsx:323-326](src/components/CaseChat.tsx#L323-L326)
   is untouched by this plan.
5. Confirm a role with no chat access (e.g. a designer not assigned to this case) still gets the
   `forbidden` screen and never sees the attach button — untouched, gated earlier by
   `canAccessCaseChat` server-side.
6. Try a file >500MB and an unsupported extension from the admin side — confirm the same
   client-side and server-side limits that already apply to clients now apply identically.

---

## 5. Files touched

| File | Change |
|---|---|
| [src/components/CaseChat.tsx](src/components/CaseChat.tsx) | Remove `side === "lab"` gate on attach UI; remove role guard in `handleFileChange` |
| [src/app/api/cases/[id]/chat/route.ts](src/app/api/cases/[id]/chat/route.ts) | Remove `isClientRole` 403 block in `POST` |

No migration, no new endpoint, no feature flag — low-risk, additive-permission change.

---

**No code has been modified. Implementation starts after you confirm this plan (and tell me
whether to also fix §3's bubble-alignment gap in the same pass).**
