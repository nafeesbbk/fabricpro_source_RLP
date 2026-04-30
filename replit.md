# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Projects

### FabricPro (Main App)
- **Purpose**: Job Work Management System for fabric industry businesses
- **Users**: Seth ji (business owners) and Karigar (workers)
- **Features**: 
  - OTP-based login (dev OTP: 123456)
  - KYC registration: name + mobile + address + Aadhaar (optional 12-digit)
  - Colored avatar system: `UserAvatar` component generates deterministic colored initials by userId (in components/user-avatar.tsx), falls back to photo if uploaded
  - Connection system with accept/reject requests; contacts page shows phone number
  - New slip system: Maal Dena (Seth→Karigar, multi-item), Maal Aya (view+confirm), Maal Wapas Jama (Karigar→Seth, references Seth slips with balance tracking), Maal Wapas Aya (Seth views returns)
  - Balance tracking per slip: Total / Jama / Damage / Shortage / Balance with auto-completion
  - Shortage deduction calculation: shortageQty × rate = payment deduction
  - Slip-wise payment tracking: slipsTable has paymentBill, paidAmount, paymentStatus fields; GET /payments/pending-slips returns slips with balance; POST /payments/record-slip-payment records multi-slip payments; slip auto-marks "completed" when fully paid
  - Payment new flow: 3-step (select karigar → select pending slips → enter amounts + screenshot); "Sab Chuno" select-all; slip must have `rate` set for paymentBill to auto-compute (rate × quantity)
  - Real-time notifications
  - Role-based dashboards (Seth ji / Karigar)
  - Admin panel: user management (password/mobile/chat toggle) + Plan activation + Settings tab
  - Profile photos: upload via camera button on profile page, stored as base64 JPEG
  - Chat: text + voice + image messages, reply-with-tagging, search with Add Contact button; colored avatars throughout
  - Contacts nav (renamed from "Karigar"), per-contact avatarUrl + phone display
  - Chat thread header shows other user's avatarUrl + online status
  - Subscription plans: Trial (30days/100slips), Basic (₹100/month), Pro (₹250/month); fields: plan, trialStartedAt, planExpiresAt, slipsUsed
  - Admin-configurable plan settings stored in app_settings table (key-value)
- **URL**: `/` (root)
- **Language**: Hinglish UI

### API Server
- **Purpose**: REST API backend for FabricPro
- **URL**: `/api`
- **Auth**: Bearer token in `fabricpro_token` localStorage key
- **Dev OTP**: Always "123456" for any mobile number

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS (artifacts/fabricpro)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Colors**: Deep indigo primary + saffron accent

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/fabricpro run dev` — run frontend locally

## Demo Accounts

- **Seth ji**: mobile `9876543210`, code `DEMO001`, name Ramesh Seth
- **Karigar**: mobile `9876543211`, code `DEMO002`, name Suresh Karigar
- **Admin**: mobile `9999999999`, code `ADMIN01`

## Auth

- Login with mobile number → OTP (always `123456` in dev)
- Token stored in `localStorage["fabricpro_token"]`
- All API calls use Bearer token auth via `setAuthTokenGetter`

## DB Schema

Tables: `users`, `otp`, `sessions`, `connections`, `slips`, `payments`, `notifications`

See `lib/db/src/schema/` for full schema.

## Future Considerations (Baad Mein Dekhna)

- **Dual-role connection**: Same user can be Seth in one context and Karigar in another (e.g., A gives maal to B → A is Seth; B also gives maal to A → B is Seth). Currently system allows only ONE connection between two users, so dual-role is blocked. Fix: allow two connections between same pair with different roleLables, and show the user in BOTH Seth list and Karigar list on statement page.
