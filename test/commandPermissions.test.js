const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'src/bot/utils/commandPermissions.js');
const {
  ensureElevatedCommandAccess,
  hasElevatedCommandAccess,
  requiresElevatedCommandAccess,
  __testables,
} = require(modulePath);

test('requiresElevatedCommandAccess only flags protected commands', () => {
  assert.equal(requiresElevatedCommandAccess('scrape'), true);
  assert.equal(requiresElevatedCommandAccess('runtestscheduler'), true);
  assert.equal(requiresElevatedCommandAccess('testgitpushdb'), true);
  assert.equal(requiresElevatedCommandAccess('search'), false);
});

test('hasElevatedCommandAccess accepts ManageGuild member permissions', () => {
  const interaction = {
    memberPermissions: {
      has() {
        return true;
      },
    },
  };

  assert.equal(hasElevatedCommandAccess(interaction), true);
});

test('hasRoleBasedAccess accepts configured admin role name', () => {
  const interaction = {
    member: {
      roles: {
        cache: {
          some(callback) {
            return callback({ name: 'Admin' });
          },
        },
      },
    },
  };

  const allowedRoles = __testables.resolveAllowedRoleNames({ ADMIN_ROLE_NAMES: 'Admin,Ops' });
  assert.equal(__testables.hasRoleBasedAccess(interaction, allowedRoles), true);
});

test('ensureElevatedCommandAccess denies protected command without permissions', async () => {
  const replies = [];
  const interaction = {
    memberPermissions: {
      has() {
        return false;
      },
    },
    member: {
      roles: {
        cache: {
          some() {
            return false;
          },
        },
      },
    },
    async reply(payload) {
      replies.push(payload);
    },
  };

  const allowed = await ensureElevatedCommandAccess(interaction, 'scrape');
  assert.equal(allowed, false);
  assert.deepEqual(replies, [{
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  }]);
});

test('ensureElevatedCommandAccess allows non-protected commands', async () => {
  const replies = [];
  const interaction = {
    async reply(payload) {
      replies.push(payload);
    },
  };

  const allowed = await ensureElevatedCommandAccess(interaction, 'search');
  assert.equal(allowed, true);
  assert.equal(replies.length, 0);
});

