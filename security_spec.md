# Smart POS ERP Security Specification

## 1. Data Invariants
1. **Tenant & Owner Isolation**: Every store document (`/stores/{storeId}`) and subcollection record (`products`, `sales`, `customers`, `suppliers`, `purchases`, `expenses`, `shifts`) must carry `ownerId == request.auth.uid` matching the parent store's `ownerId`.
2. **Email Verification**: All mutations require `request.auth != null && request.auth.token.email_verified == true`.
3. **Path ID Hardening**: All document IDs (`storeId`, `productId`, `saleId`, `customerId`, `supplierId`, `purchaseId`, `expenseId`, `shiftId`, `userId`) must match `^[a-zA-Z0-9_\-]+$` with length `<= 128`.
4. **Immutable Ownership & Timestamps**: `ownerId`, `storeId`, and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
5. **Terminal State Locking**: Invoices with `status in ['completed', 'cancelled']` and shifts with `status == 'closed'` cannot be updated by non-admins.
6. **PII Isolation**: User PII (`email`, `displayName`) lives strictly under `/users/{userId}/private/{docId}` readable/writable only by the owning user (`request.auth.uid == userId`) or an admin.
7. **Zero Self-Assigned Roles**: Users cannot write `role` or `isAdmin` fields on `/users/{userId}/private/{docId}` or `/admins/{userId}`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Product Create**: `auth = null`, create `/stores/s1/products/p1` -> `PERMISSION_DENIED`.
2. **Unverified Email Mutation**: `auth.token.email_verified = false`, create `/stores/s1/sales/inv1` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Store Create**: `auth.uid = 'u1'`, `ownerId = 'u2'` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Product**: Create product with extra `"isAdminOverride": true` ghost field -> `PERMISSION_DENIED`.
5. **Orphan Subcollection Write**: Create `/stores/nonexistent/products/p1` when parent store does not exist -> `PERMISSION_DENIED`.
6. **Cross-Tenant Product Read/List**: `auth.uid = 'u2'` queries `/stores/s1/products` where `ownerId == 'u1'` -> `PERMISSION_DENIED`.
7. **ID Poisoning Attack**: Create product with `productId = 'a'.repeat(200)` or `'bad/id$1'` -> `PERMISSION_DENIED`.
8. **Client Timestamp Forgery**: Create sale with `createdAt = '2020-01-01T00:00:00Z'` instead of `request.time` -> `PERMISSION_DENIED`.
9. **Terminal Invoice Tampering**: Non-admin attempts to update `grandTotal` on a `completed` sale invoice -> `PERMISSION_DENIED`.
10. **Closed Shift Tampering**: Non-admin attempts to update `actualCash` on a `closed` shift -> `PERMISSION_DENIED`.
11. **PII Cross-User Read**: `auth.uid = 'u2'` attempts `get` on `/users/u1/private/profile` -> `PERMISSION_DENIED`.
12. **Self-Assigned Admin Escalation**: `auth.uid = 'u1'` attempts to write `/admins/u1` or add `role: 'admin'` to `/users/u1/private/profile` -> `PERMISSION_DENIED`.
