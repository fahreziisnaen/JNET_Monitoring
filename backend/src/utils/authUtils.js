/**
 * authUtils.js
 * Centralized authentication and authorization utilities.
 */

/**
 * Gets the list of Super Admin IDs from environment variables.
 * Fallback to [1] if not configured.
 * @returns {number[]} Array of Super Admin user IDs.
 */
const getSuperAdminIds = () => {
    return process.env.SUPER_ADMIN_IDS
        ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
        : [1];
};

/**
 * Checks if a user ID is in the Super Admin list.
 * @param {number} userId 
 * @returns {boolean}
 */
const isSuperAdmin = (userId) => {
    if (!userId) return false;
    const superAdminIds = getSuperAdminIds();
    return superAdminIds.includes(parseInt(userId));
};

module.exports = {
    getSuperAdminIds,
    isSuperAdmin
};
