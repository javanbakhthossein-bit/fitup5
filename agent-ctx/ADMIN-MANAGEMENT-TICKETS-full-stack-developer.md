# Task ID: ADMIN-MANAGEMENT-TICKETS
Agent: full-stack-developer
Task: Admin management + ticket system

## Work Log

### Task 1: Admin Management System

**1a. `/api/admin/admins/route.ts`** (NEW)
- **GET**: Lists all admin users with their AdminPermission records. Requires `canManageAdmins` permission (or super admin).
- **POST**: Creates new admin by mobile number. Body: `{ mobile, name?, permissions }`.
  - If user with mobile doesn't exist → creates new user with `role: "ADMIN"`, `onboardingDone: true`, active terms version stamped
  - If user exists → upgrades role to ADMIN, sets name
  - Calls `ensureAdminPerks()` to grant: `planName: "ultimate"`, 365-day subscription, wallet 10,000,000 Toman
  - Upserts AdminPermission record with provided permissions (11 boolean fields)
  - Only super admin (09300083803) can grant `canManageAdmins` permission
  - Sends notification to the new admin
- Super admin (mobile 09300083803) bypasses the `canManageAdmins` check

**1b. `/api/admin/admins/[id]/route.ts`** (NEW)
- **PATCH**: Updates admin permissions and/or name. Body: `{ permissions }` or `{ name }`.
  - Cannot modify super admin or self
  - Only super admin can grant `canManageAdmins` permission
  - Notifies the affected admin about the change
- **DELETE**: Removes admin role (sets `role: "USER"`, deletes AdminPermission record)
  - Cannot delete super admin or self
  - Notifies the user about removal

**1c. `/api/admin/permissions/route.ts`** (NEW)
- **GET**: Returns the current admin's permissions + admin profile info
- If super admin (mobile 09300083803) → returns all-true permissions
- If admin has AdminPermission record → returns the stored permissions
- If admin has NO AdminPermission record (legacy admin) → returns all-true (permissive fallback)

**1d. Auth flow** — verified existing behavior:
- `page.tsx` already does `if (data.user.role === "ADMIN") setScreen("admin")` after `/api/auth/me`
- `auth-screen.tsx` already does `if (data.role === "ADMIN") setScreen("admin")` after `/api/auth/verify-otp`
- All admin users (super admin + any new admins created via the new API) go to the admin panel screen
- No changes needed here — the existing flow is correct.

**1e. AdminsTab component** (in admin-overlay.tsx)
- Lists all admins as cards showing: avatar (★ for super admin, initial otherwise), name, super admin/admin badge, mobile (with phone icon), active permission badges (up to 6, then "+N" indicator)
- "افزودن ادمین" button → opens AdminEditDialog (create mode)
- Edit (pencil) button on each non-super-admin → opens AdminEditDialog (edit mode)
- Delete (trash) button → confirms removal, calls DELETE endpoint
- Super admin card has no edit/delete buttons (protected)

**AdminEditDialog** component:
- Two modes: `create` and `edit`
- Create mode: mobile input (with validation regex `^09\d{9}$`), name input (optional), permissions switches
- Edit mode: mobile shown as read-only context, name input, permissions switches
- 11 permission switches (Switch component) in a grouped card with Persian labels
- Calls POST `/api/admin/admins` for create or PATCH `/api/admin/admins/[id]` for edit
- Success toast + dialog close + list refresh

**1f. Permission-based tab visibility** — modified `AdminOverlay` component:
- Added `permissions` state (default: all-true) + `permsLoaded` flag
- Fetches `/api/admin/permissions` on mount
- `allTabs` array now has `perm` field mapping each tab to a permission key
- `tabs` is filtered from `allTabs` based on `permissions[t.perm]`
- useEffect ensures the current tab falls back to first available if it's not in the filtered list (e.g., if perms changed)

### Task 2: Support Ticket System

**2a. Athlete panel: Support tab**
- Added `"support"` to `MainTab` type in `store.ts`
- Added `support` to `validTabs` in `page.tsx` for `?tab=support` URL routing
- Added `{ id: "support", label: "پشتیبانی", icon: Headphones }` to NAV_ITEMS in `main-app.tsx`
- Added `{mainTab === "support" && <SupportView />}` to render

**SupportView component** (`/src/components/fitness/views/support-view.tsx`):
- **Header**: orange gradient icon + "پشتیبانی" title + subtitle + "تیکت جدید" button
- **List view**: ticket cards showing subject, message preview, status badge, priority badge, category badge, reply count, jalali date
- **Empty state**: "هنوز تیکتی ثبت نکرده‌اید" with retry button
- **Ticket detail view**: back button, ticket header card (subject, status, category, priority, message), reply thread (max-h-40vh scrollable, admin bubbles vs user bubbles styled differently), reply textarea + send button
- **New ticket dialog**: subject input, category dropdown (عمومی/فنی/پرداخت/برنامه/باگ), priority dropdown (کم/معمولی/مهم/فوری), message textarea, submit button
- Persian color theme (orange/amber for primary, slate for user bubbles, emerald/cyan for status badges)
- Auto-refreshes ticket on mount; auto-scrolls to bottom on new replies

**2b. `/api/support/tickets/route.ts`** (NEW)
- **GET**: Returns current user's tickets (or all tickets for admins) with replies + user info
- **POST**: Creates a new ticket. Body: `{ subject, category, priority, message }`.
  - Validates subject (≥3 chars) and message (≥5 chars)
  - Validates category and priority against whitelists
  - Notifies all admins (role = "ADMIN") about the new ticket via `notification.createMany`

**2c. `/api/support/tickets/[id]/route.ts`** (NEW)
- **GET**: Returns a single ticket with all replies. User can only read their own; admin can read any.
- **POST** (reply): Adds a TicketReply. Body: `{ message }`.
  - Admin: sets ticket status to `"answered"`, sets `adminReply`, `repliedById`, `repliedAt`. Notifies the ticket owner.
  - User: sets ticket status to `"open"` (re-opens if was answered). Notifies all admins.
  - User cannot reply to a closed ticket (must reopen first).
- **PATCH**: Updates ticket status. Body: `{ status }`. Admin only. Valid statuses: `open | answered | closed`. Notifies the ticket owner about status change.

**2d. Admin panel: Tickets tab** (in admin-overlay.tsx)
- `{ id: "tickets", label: "تیکت‌ها", icon: MessageSquare, perm: "canManageTickets" }` added to allTabs
- **TicketsTab component**: 
  - Filter dropdowns (status, category, priority)
  - Refresh button
  - Ticket list (max-h-70vh scrollable) with user info (name, mobile, plan badge) + ticket info
  - Empty state with icon
- **AdminTicketDetail component**:
  - User info card (avatar, name, mobile, plan badge, status badge)
  - Ticket message card (subject, date, category, priority, message)
  - Reply thread (max-h-40vh scrollable, admin vs user bubbles styled differently)
  - Reply form (textarea + send button)
  - Status action buttons: "باز کردن" / "پاسخ داده شد" / "بستن" (disabled if already in that status)
  - Auto-scrolls to bottom on new replies

### Technical Details

**Database (Prisma)**:
- Models `AdminPermission`, `SupportTicket`, `TicketReply` were already in schema.prisma (no schema changes needed)
- Bumped db.ts SCHEMA_VERSION to `v8-admin-tickets` and added stale-client checks for new models
- Ran `bun run db:push` (already in sync, just regenerated client)

**Super admin**:
- Mobile `09300083803` is the super admin
- Always has all permissions (no AdminPermission record needed)
- Cannot be edited or deleted
- Can grant `canManageAdmins` permission to others (only super admin can)

**Admin perks for new admins**:
- Same as super admin: ultimate plan + 365-day subscription + 10,000,000 Toman wallet
- Implemented via shared `ensureAdminPerks()` helper

**Notifications**:
- Created using `db.notification.create({ data: { userId, type, title, body, read: false } })`
- New admin added → notify the new admin
- Admin perms updated → notify the affected admin
- Admin removed → notify the affected user
- New ticket created → notify all admins (via `notification.createMany`)
- Admin replies → notify the ticket owner
- User replies → notify all admins
- Ticket status changed → notify the ticket owner

**Files created**:
- `/src/app/api/admin/admins/route.ts`
- `/src/app/api/admin/admins/[id]/route.ts`
- `/src/app/api/admin/permissions/route.ts`
- `/src/app/api/support/tickets/route.ts`
- `/src/app/api/support/tickets/[id]/route.ts`
- `/src/components/fitness/views/support-view.tsx`

**Files modified**:
- `/src/lib/db.ts` — bumped SCHEMA_VERSION, added stale-client checks for AdminPermission/SupportTicket/TicketReply
- `/src/lib/fitness/store.ts` — added `"support"` to MainTab type
- `/src/app/page.tsx` — added "support" to validTabs for URL routing
- `/src/components/fitness/main-app.tsx` — imported Headphones + SupportView, added support tab to NAV_ITEMS + render
- `/src/components/fitness/views/admin-overlay.tsx` — added AdminTab types for "admins" + "tickets", added permissions state + filtering, added AdminsTab + AdminCard + AdminEditDialog + TicketsTab + AdminTicketDetail components

## Stage Summary

### Admin Management System
- **3 new API endpoints**: `/api/admin/admins` (GET list + POST create), `/api/admin/admins/[id]` (PATCH update + DELETE remove), `/api/admin/permissions` (GET current admin's perms)
- **New "مدیریت ادمین‌ها" tab** in admin panel (only visible if `canManageAdmins` permission is true)
- Super admin (mobile 09300083803) sees all tabs and cannot be edited or deleted
- New admins automatically get ultimate plan + 365-day subscription + 10,000,000 Toman wallet (same perks as super admin)
- 11 granular permissions control which tabs each admin sees (dashboard, users, finance, programs, checkups, articles, head_codes, terms, tickets, copilot, admins)
- Permission-based tab visibility — tabs without permission are hidden from the UI
- Only super admin can grant the `canManageAdmins` permission to other admins

### Support Ticket System
- **2 new API endpoints**: `/api/support/tickets` (GET list + POST create), `/api/support/tickets/[id]` (GET single + POST reply + PATCH status)
- **New "پشتیبانی" tab** in athlete panel — users can submit and track support tickets
- **New "تیکت‌ها" tab** in admin panel (only visible if `canManageTickets` permission is true) — admins can see all tickets with filters (status/category/priority), view conversation threads, reply, and close/reopen tickets
- Threaded replies with separate bubbles for admin vs user
- Notifications sent to the appropriate party when:
  - New ticket created (admins notified)
  - Admin replies (ticket owner notified)
  - User replies (all admins notified)
  - Admin status change (ticket owner notified)
- 5 categories (عمومی، فنی، پرداخت، برنامه، باگ) and 4 priorities (کم، معمولی، مهم، فوری)

### Quality
- `bun run lint` → **0 errors, 29 warnings** (all pre-existing "Unused eslint-disable directive" warnings; my new code introduces 0 new warnings)
- All 6 new API endpoints compile and return proper 401 for unauthenticated requests (verified via curl smoke tests)
- Prisma client regenerated with v8 schema version, new models (adminPermission, supportTicket, ticketReply) confirmed available
- Dev server compiles cleanly, no runtime errors in dev.log
- All existing functionality preserved (no breaking changes)
