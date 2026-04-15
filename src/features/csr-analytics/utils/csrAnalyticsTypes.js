/**
 * @fileoverview Data normalisation for the CSR Analytics feature.
 *
 * Converts raw ticket objects produced by `transformCSRIssue` (from
 * `csrService.js`) into stable `NormalizedCsrTicket` objects consumed by all
 * downstream hooks and components.
 *
 * Call `normalizeTicket(rawTicket)` once per raw ticket. The result is
 * immutable — do not mutate it after creation.
 */

import { getSLARisk } from '../../../utils/csrService.js';

// ---------------------------------------------------------------------------
// Typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} NormalizedCsrTicket
 * @property {string}      key             - Jira issue key (e.g. "CSR-123")
 * @property {string}      summary         - Issue summary text
 * @property {string}      project         - Project name
 * @property {string}      bank            - Derived bank name from reporter email
 * @property {string}      assignee        - Assignee display name (or 'Unassigned')
 * @property {string}      status          - Raw Jira status name
 * @property {string}      issueType       - Issue type name
 * @property {string}      createdAt       - ISO date string (from raw `created`)
 * @property {string}      updatedAt       - ISO date string (from raw `updated`)
 * @property {string|null} resolvedAt      - ISO date string or null
 * @property {boolean}     isOpen          - true when status is not Completed/Closed/Done
 * @property {boolean}     isResolved      - true when resolvedAt is a non-null, non-empty string
 * @property {number}      ageDays         - Integer days from createdAt to today
 * @property {number|null} resolutionDays  - Integer days from createdAt to resolvedAt, or null
 * @property {'on-track'|'at-risk'|'breaching'} slaState - Derived from getSLARisk
 * @property {boolean}     isLegacy        - true when createdAt is more than 2 years ago
 */

// ---------------------------------------------------------------------------
// normalizeTicket
// ---------------------------------------------------------------------------

/**
 * Maps a raw ticket object (as produced by `transformCSRIssue`) to a
 * `NormalizedCsrTicket`.
 *
 * Raw ticket fields consumed:
 *   `key`, `summary`, `status`, `statusCat`, `assignee`, `bank`, `project`,
 *   `projectKey`, `issueType`, `priority`, `created`, `updated`, `resolved`,
 *   `age`, `isSLABreach`, `slaRisk`, `jiraBreached`
 *
 * Derived fields:
 * - `isOpen`          — `true` when status is not `'Completed'` or `'Closed'`
 *                       AND statusCat is not `'Done'`
 * - `isResolved`      — `true` when `resolved` is a non-null, non-empty string
 * - `ageDays`         — `Math.floor((Date.now() - new Date(created)) / 86400000)`
 * - `resolutionDays`  — floor-division formula when `resolved` is non-null, else `null`
 * - `slaState`        — result of `getSLARisk(rawTicket)` for consistency
 * - `isLegacy`        — `new Date(created) < new Date(Date.now() - 2 * 365 * 86400000)`
 *
 * @param {object} rawTicket - Raw ticket from `transformCSRIssue`.
 * @returns {NormalizedCsrTicket}
 */
export function normalizeTicket(rawTicket) {
  const {
    key        = '',
    summary    = '',
    status     = '',
    statusCat  = '',
    assignee   = '',
    bank       = '',
    project    = '',
    issueType  = '',
    created    = '',
    updated    = '',
    resolved   = null,
  } = rawTicket;

  // ── Derived: isOpen ──────────────────────────────────────────────────────
  const isOpen =
    status !== 'Completed' &&
    status !== 'Closed' &&
    statusCat !== 'Done';

  // ── Derived: isResolved ──────────────────────────────────────────────────
  const isResolved = resolved != null && resolved !== '';

  // ── Derived: ageDays ─────────────────────────────────────────────────────
  const ageDays = created
    ? Math.floor((Date.now() - new Date(created)) / 86400000)
    : 0;

  // ── Derived: resolutionDays ───────────────────────────────────────────────
  const resolutionDays =
    isResolved
      ? Math.floor((new Date(resolved) - new Date(created)) / 86400000)
      : null;

  // ── Derived: slaState ─────────────────────────────────────────────────────
  // Re-derive via getSLARisk for consistency (ignores the cached slaRisk field).
  const slaState = getSLARisk(rawTicket);

  // ── Derived: isLegacy ─────────────────────────────────────────────────────
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000);
  const isLegacy = created ? new Date(created) < twoYearsAgo : false;

  return {
    key,
    summary,
    project,
    bank,
    assignee,
    status,
    issueType,
    createdAt:      created,
    updatedAt:      updated,
    resolvedAt:     resolved ?? null,
    isOpen,
    isResolved,
    ageDays,
    resolutionDays,
    slaState,
    isLegacy,
  };
}
