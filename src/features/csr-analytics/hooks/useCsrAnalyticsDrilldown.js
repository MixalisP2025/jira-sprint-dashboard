/**
 * @fileoverview React hook for managing DrilldownFilters state in the CSR Analytics feature.
 *
 * Provides drilldown filter state as an array of DrilldownFilter objects,
 * with upsert, clear-all, and clear-by-dimension operations.
 *
 * DrilldownFilters are set by chart interactions (bar clicks, segment clicks)
 * and are managed independently of ManualFilters.
 */

import { useState } from 'react';

/**
 * @typedef {{ dimension: string, value: any, label?: string }} DrilldownFilter
 */

/**
 * Hook that manages the DrilldownFilters state for the CSR Analytics page.
 *
 * @returns {{
 *   drilldowns: DrilldownFilter[],
 *   setDrilldown: (filter: DrilldownFilter) => void,
 *   clearDrilldown: () => void,
 *   clearDrilldownDimension: (key: string) => void,
 * }}
 *
 * @example
 * const { drilldowns, setDrilldown, clearDrilldown, clearDrilldownDimension } =
 *   useCsrAnalyticsDrilldown();
 *
 * // Set (or replace) a drilldown for a dimension
 * setDrilldown({ dimension: 'week-created', value: '2025-W20', label: 'Week 20' });
 *
 * // Remove a single dimension
 * clearDrilldownDimension('week-created');
 *
 * // Remove all drilldowns
 * clearDrilldown();
 */
export function useCsrAnalyticsDrilldown() {
  /** @type {[DrilldownFilter[], Function]} */
  const [drilldowns, setDrilldowns] = useState(/** @type {DrilldownFilter[]} */ ([]));

  /**
   * Upserts a DrilldownFilter by dimension.
   *
   * If a drilldown with the same `dimension` already exists it is replaced;
   * otherwise the new filter is appended to the array.
   *
   * @param {DrilldownFilter} filter - The drilldown filter to set.
   */
  function setDrilldown(filter) {
    setDrilldowns((prev) => {
      const exists = prev.some((d) => d.dimension === filter.dimension);
      if (exists) {
        return prev.map((d) => (d.dimension === filter.dimension ? filter : d));
      }
      return [...prev, filter];
    });
  }

  /**
   * Removes all DrilldownFilters, resetting the state to an empty array.
   */
  function clearDrilldown() {
    setDrilldowns([]);
  }

  /**
   * Removes the DrilldownFilter whose `dimension` matches the given key.
   * All other drilldowns are preserved unchanged.
   *
   * @param {string} key - The dimension key to remove.
   */
  function clearDrilldownDimension(key) {
    setDrilldowns((prev) => prev.filter((d) => d.dimension !== key));
  }

  return { drilldowns, setDrilldown, clearDrilldown, clearDrilldownDimension };
}

export default useCsrAnalyticsDrilldown;
