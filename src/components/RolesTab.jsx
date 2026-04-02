import React, { useState, useEffect } from 'react';
import { Edit3, Save, X, Printer } from 'lucide-react';
import { saveRolesToDB, loadRolesFromDB, pingDB } from '../utils/dbSync';

const ROLES_KEY = 'rolesTabData';

const DEFAULT_ROLES = [
  {
    id: 'management',
    title: 'Management',
    bullets: [
      'Set business goals and portfolio priorities.',
      'Approve high-level time/cost estimates and financial proposals.',
      'Oversee sales, PR, and marketing; track market trends.',
      'Resolve cross-project priority conflicts.',
    ],
    responsible: 'Stathis',
  },
  {
    id: 'po',
    title: 'Product Owner (PO)',
    bullets: [
      'Accept and refine user requests; maintain backlog.',
      'Lead client requirement definition with Project/Business roles.',
      'Provide domain expertise and on-demand consulting.',
      'Define acceptance criteria; accept/reject completed work.',
    ],
    responsible: 'Stathis; Tania (TBC); Kostas K (TBC)',
  },
  {
    id: 'pro',
    title: 'Project Owner (PrO)',
    bullets: [
      'Co-lead client requirement definition and user workshops.',
      'Approve functional requirements.',
      'Provide/validate high-level time & cost estimates with Management.',
      'Define project timelines, milestones, deliverables.',
      'With PM, form teams, set priorities, plan sprints; track actuals vs estimates.',
    ],
    responsible: 'Stathis; Tania; Kostas K',
  },
  {
    id: 'pm',
    title: 'Project Manager (PM)',
    bullets: [
      'Manage timelines, resources, and risks via Agile/Scrum.',
      'With PO/PrO, plan sprints and release trains; maintain RAID log.',
      'Facilitate UAT logistics and participation.',
      'Operate client UAT tools (e.g., Azure DevOps); report UAT results to Team Leader as bugs/tasks.',
      'Record UAT sign-offs in DnD; trigger go-live.',
      'Report actuals vs estimates back to Project Owner.',
    ],
    responsible: 'Michalis',
  },
  {
    id: 'ba',
    title: 'Business Analyst (BA)',
    bullets: [
      'Run client workshops; capture functional requirements.',
      'Write user stories and acceptance criteria; contribute to UI design notes.',
      'Prepare integration test scenarios; assist in integration testing.',
    ],
    responsible: 'Stathis; Tania; Kostas K',
  },
  {
    id: 'architect',
    title: 'Software Architect / Designer',
    bullets: [
      'Participate in requirements (as needed); shape solution architecture.',
      'Provide high-level estimates and key technical decisions.',
      'Define data model and required DB changes.',
      'Create technical tasks in Jira; set development guidelines.',
      'Mentor developers; provide implementation methods.',
    ],
    responsible: 'Stefanos; Sofia',
  },
  {
    id: 'tl',
    title: 'Team Leader (TL)',
    bullets: [
      'Own technical outcomes for tasks and deliverables; estimate effort.',
      'Coordinate FE/BE developers; oversee DnD logs quality.',
      'Oversee integration and UAT sessions; handle changes (not bugs) from UAT in alignment with BA/PO.',
      'Sign off development tasks in Jira (→ Awaiting Versioning) and in DnD (→ Next Available).',
    ],
    responsible: 'Kostas G; Stefanos; Tasos; Sotiris; Kostas K; Tania',
  },
  {
    id: 'fed',
    title: 'Front-end Developer (FED)',
    bullets: [
      'Implement UI; participate in integration tests.',
      'Record modifications in DnD (technical + client descriptions where relevant for Delphi).',
      'Provide sources for releases (for web UIs).',
    ],
    responsible: 'Stefanos; Tasos; Kostas K; Antonis; Sotiris; Tania; George P',
  },
  {
    id: 'bed',
    title: 'Back-end Developer (BED)',
    bullets: [
      'Develop services; perform unit testing; join integration tests.',
      'Record modifications in DnD (technical + client descriptions as applicable).',
    ],
    responsible: 'Stefanos; Tasos; Kostas K; Antonis; Sotiris; Sofia; Tania',
  },
  {
    id: 'rm',
    title: 'Release Manager (RM)',
    bullets: [
      'With PO/PM, set release dates and decide scope.',
      'Manage DnD logs; collect units to be delivered; perform unit merging.',
    ],
    responsible: 'Tania',
  },
  {
    id: 'deployer',
    title: 'Deployer',
    bullets: [
      'Perform file transfers and maintain Delphi projects from DnD logs.',
      'Create executables (UI + server) and DB versions per DnD.',
      'Maintain configuration; send releases to clients; install on site where needed.',
      'Collaborate with Developers and TL for DnD quality and client descriptions.',
      'Provide change lists to users.',
    ],
    responsible: 'Tania; Antonis (temp)',
  },
  {
    id: 'support',
    title: 'Support Agent',
    bullets: [
      'Support release installation and initial issue triage.',
    ],
    responsible: 'Sotiris; Kostas K',
  },
];

// ─── RoleCard ─────────────────────────────────────────────────────────────────
function RoleCard({ role, onSave }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle]     = useState(role.title);
  const [bulletsText, setBulletsText] = useState(role.bullets.join('\n'));
  const [responsible, setResponsible] = useState(role.responsible);

  function handleSave() {
    const bullets = bulletsText.split('\n').map(b => b.trim()).filter(Boolean);
    onSave({ ...role, title, bullets, responsible });
    setEditing(false);
  }

  function handleCancel() {
    setTitle(role.title);
    setBulletsText(role.bullets.join('\n'));
    setResponsible(role.responsible);
    setEditing(false);
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 print-card">
      {editing ? (
        <div className="flex flex-col gap-3">
          <input
            className="bg-slate-700 border border-slate-600 text-white text-sm font-semibold rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={title} onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono"
            rows={role.bullets.length + 1}
            value={bulletsText}
            onChange={e => setBulletsText(e.target.value)}
            placeholder="One bullet per line"
          />
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Responsible</label>
            <input
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={responsible} onChange={e => setResponsible(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
              <Save size={12} /> Save
            </button>
            <button onClick={handleCancel}
              className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">{role.title}</h3>
            <button onClick={() => setEditing(true)}
              className="text-slate-500 hover:text-slate-300 transition-colors ml-2 shrink-0 no-print">
              <Edit3 size={13} />
            </button>
          </div>
          <ul className="space-y-1 mb-3">
            {role.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-300">
                <span className="text-slate-500 shrink-0 mt-0.5">·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-700 pt-2 mt-2">
            <span className="text-xs text-slate-500">Responsible: </span>
            <span className="text-xs text-blue-400 font-medium">{role.responsible}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RolesTab ─────────────────────────────────────────────────────────────────
export default function RolesTab() {
  const [roles, setRoles] = useState(() => {
    try {
      const saved = localStorage.getItem(ROLES_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_ROLES;
  });

  // On mount: try to load from DB, fall back to localStorage
  useEffect(() => {
    async function load() {
      try {
        const online = await pingDB();
        if (online) {
          const dbRoles = await loadRolesFromDB();
          if (Array.isArray(dbRoles) && dbRoles.length > 0) {
            setRoles(dbRoles);
            return;
          }
        }
      } catch (_) {}
      // localStorage already loaded via useState initialiser
    }
    load();
  }, []);

  useEffect(() => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(roles));
    // Persist to DB (fire-and-forget)
    pingDB().then(online => {
      if (online) saveRolesToDB(roles).catch(() => {});
    }).catch(() => {});
  }, [roles]);

  function handleSave(updated) {
    setRoles(prev => prev.map(r => r.id === updated.id ? updated : r));
  }

  function handleReset() {
    if (!window.confirm('Reset all roles to defaults?')) return;
    setRoles(DEFAULT_ROLES);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <>
      {/* Print styles injected inline */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #roles-print-root { display: block !important; }
          .no-print { display: none !important; }
          .print-card { break-inside: avoid; }
          #roles-print-root { color: #000; background: #fff; padding: 24px; }
          #roles-print-root h3 { color: #000; }
          #roles-print-root li, #roles-print-root span { color: #333; }
          #roles-print-root .border-t { border-color: #ccc; }
        }
      `}</style>

      <div id="roles-print-root" className="flex flex-col gap-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 no-print">
          <span className="text-sm font-semibold text-slate-100">Team Roles &amp; Responsibilities</span>
          <div className="flex gap-2">
            <button onClick={handleReset}
              className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
              Reset to Defaults
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
              <Printer size={12} /> Print / PDF
            </button>
          </div>
        </div>

        {/* Grid of role cards */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {roles.map(role => (
            <RoleCard key={role.id} role={role} onSave={handleSave} />
          ))}
        </div>
      </div>
    </>
  );
}
