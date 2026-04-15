/**
 * @fileoverview React hook for managing ManualFilters state in the CSR Analytics feature.
 *
 * Provides filter state initialised from DEFAULT_MANUAL_FILTERS, a setter for
 * individual fields, and a reset function that restores all fields to their
 * default values.
 */

import { useState } from 'react';
import { DEFAULT_MANUAL_FILTERS } from '../utils/csrAnalyticsConstants.js';

/**
 * Returns a deep copy of DEFAULT_MANUAL_FILTERS to avoid shared-reference
 * mutations between renders.
 *
 * @returns {import('../utils/csrAnalyticsTypes').ManualFilters}
 */
function getDefaultFilters() {
  return {
    ...DEFAULT_MANUAL_FILTERS,
    dateRange: { ...DEFAULT_MANUAL_FILTERS.dateRange },
  };
}

/**
 * Hook that manages the ManualFilters state for the CSR Analytics page.
 *
 * @returns {{
 *   filters: import('../utils/csrAnalyticsTypes').ManualFilters,
 *   setFilter: (key: string, value: any) => void,
 *   resetFilters: () => void,
 * }}
 *
 * @example
 * const { filters, setFilter, resetFilters } = useCsrAnalyticsFilters();
 *
 * // Update a single field
 * setFilter('project', 'STLU');
 *
 * // Replace the whole dateRange object
 * setFilter('dateRange', { start: '2025-01-01', end: '' });
 *
 * // Restore all fields to defaults
 * resetFilters();
 */
export function useCsrAnalyticsFilters() {
  const [filters, setFilters] = useState(getDefaultFilters);

  /**
   * Updates a single field in the filters object.
   *
   * For nested fields like `dateRange`, pass the entire replacement object:
   *   setFilter('dateRange', { start: '2025-01-01', end: '' })
   *
   * @param {string} key   - The ManualFilters field name to update.
   * @param {*}      value - The new value for that field.
   */
  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Restores all ManualFilters fields to their default values.
   * Uses a fresh deep copy of DEFAULT_MANUAL_FILTERS to prevent mutation.
   */
  function resetFilters() {
    setFilters(getDefaultFilters());
  }

  return { filters, setFilter, resetFilters };
}

export default useCsrAnalyticsFilters;
