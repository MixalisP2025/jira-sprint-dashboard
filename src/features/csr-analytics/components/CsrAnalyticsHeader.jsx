import { RefreshCw, Printer, Camera } from 'lucide-react';

/**
 * Header bar for the CSR Analytics page.
 *
 * @param {{ title: string, loading: boolean, onRefresh: () => void, onSnapshot: () => void }} props
 */
export default function CsrAnalyticsHeader({ title, loading, onRefresh, onSnapshot }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700">
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded-lg hover:bg-slate-600 disabled:opacity-50 text-slate-100"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded-lg hover:bg-slate-600 text-slate-100"
        >
          <Printer size={14} />
          Print
        </button>

        <button
          type="button"
          onClick={onSnapshot}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded-lg text-white font-medium"
        >
          <Camera size={14} />
          Snapshot
        </button>
      </div>
    </div>
  );
}
