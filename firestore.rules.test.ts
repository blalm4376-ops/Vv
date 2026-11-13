import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static and structural verification of Firestore Security Rules against the "Dirty Dozen"
 * adversarial security invariants documented in security_spec.md.
 */
describe('Firestore Security Rules Verification', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  it('uses rules_version 2 and starts with a default-deny catch-all', () => {
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  it('enforces email verification and valid ID regex on all writes', () => {
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
    expect(rules).toContain('id.size() <= 128');
  });

  it('prevents shadow updates and enforces server request.time timestamps', () => {
    expect(rules).toContain('data.keys().hasOnly(');
    expect(rules).toContain('affectedKeys().hasOnly(');
    expect(rules).toContain('incoming().createdAt == request.time');
    expect(rules).toContain('incoming().updatedAt == request.time');
  });

  it('locks terminal invoice and shift states against non-admin mutations', () => {
    expect(rules).toContain("!(existing().status in ['completed', 'cancelled'])");
    expect(rules).toContain("existing().status != 'closed'");
  });

  it('isolates PII under users/{userId}/private/{docId} and restricts list queries by ownerId', () => {
    expect(rules).toContain('match /users/{userId}/private/{docId}');
    expect(rules).toContain('allow list: if isVerified() && resource.data.ownerId == request.auth.uid;');
  });
});
