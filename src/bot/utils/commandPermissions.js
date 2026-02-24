const { PermissionFlagsBits } = require('discord.js');

const ELEVATED_COMMANDS = new Set([
  'scrape',
  'dailysavedsearch',
  'runtestscheduler',
  'manualnotifynewvehicles',
  'testgitpushdb',
]);

function requiresElevatedCommandAccess(commandName) {
  return ELEVATED_COMMANDS.has(String(commandName || '').toLowerCase());
}

function resolveAllowedRoleNames(env = process.env) {
  const configured = String(env.ADMIN_ROLE_NAMES || 'Admin')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured);
}

function hasRoleBasedAccess(interaction, allowedRoleNames = resolveAllowedRoleNames()) {
  if (!allowedRoleNames || allowedRoleNames.size === 0) {
    return false;
  }

  const roleCache = interaction?.member?.roles?.cache;
  if (!roleCache) {
    return false;
  }

  if (typeof roleCache.some === 'function') {
    return roleCache.some((role) => allowedRoleNames.has(String(role?.name || '').toLowerCase()));
  }

  if (typeof roleCache.values === 'function') {
    for (const role of roleCache.values()) {
      if (allowedRoleNames.has(String(role?.name || '').toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

function hasPermissionBitAccess(interaction) {
  const bit = PermissionFlagsBits.ManageGuild;
  const permissionSets = [
    interaction?.memberPermissions,
    interaction?.member?.permissions,
  ];

  for (const permissionSet of permissionSets) {
    if (permissionSet && typeof permissionSet.has === 'function') {
      try {
        if (permissionSet.has(bit)) {
          return true;
        }
      } catch (_) {
        // Ignore malformed permission sets and continue evaluating fallbacks.
      }
    }
  }

  return false;
}

function hasElevatedCommandAccess(interaction) {
  return hasPermissionBitAccess(interaction) || hasRoleBasedAccess(interaction);
}

async function replyNoPermission(interaction) {
  const payload = {
    content: 'You do not have permission to use this command.',
    ephemeral: true,
  };

  if (interaction?.deferred || interaction?.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

async function ensureElevatedCommandAccess(interaction, commandName) {
  if (!requiresElevatedCommandAccess(commandName)) {
    return true;
  }

  if (hasElevatedCommandAccess(interaction)) {
    return true;
  }

  await replyNoPermission(interaction);
  return false;
}

module.exports = {
  ensureElevatedCommandAccess,
  hasElevatedCommandAccess,
  requiresElevatedCommandAccess,
  __testables: {
    hasPermissionBitAccess,
    hasRoleBasedAccess,
    resolveAllowedRoleNames,
  },
};

