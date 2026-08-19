import { Eye, type LucideIcon } from 'lucide-react';
import { NavItem } from '../../components/primitives';
import { ProjectList } from '../tasks/ProjectList';
import type { Project, Task } from '../../../../shared/types';
import type { WorkbenchSectionId } from './workbenchNavigation';

export interface WorkbenchNavItem {
  id: WorkbenchSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  count?: number;
}

export interface WorkbenchSidebarProps {
  primaryItems: WorkbenchNavItem[];
  utilityItems: WorkbenchNavItem[];
  section: WorkbenchSectionId;
  onSelect: (id: WorkbenchSectionId) => void;
  projects: Project[];
  tasks: Task[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  unclassifiedSelected: boolean;
  onSelectUnclassified: () => void;
  projectCreateOpen: boolean;
  onProjectCreateOpenChange: (open: boolean) => void;
}

// Presentational shell: renders brand + primary nav + project list + utility
// nav. All domain data (nav item counts, project/task derivation) is computed
// by WorkbenchView and passed in — this component stays free of data hooks so
// it can be regression-tested in isolation.
export function WorkbenchSidebar({
  primaryItems,
  utilityItems,
  section,
  onSelect,
  projects,
  tasks,
  selectedProjectId,
  onSelectProject,
  unclassifiedSelected,
  onSelectUnclassified,
  projectCreateOpen,
  onProjectCreateOpenChange
}: WorkbenchSidebarProps): JSX.Element {
  return (
    <aside className="app-sidebar">
      <div className="app-brand">
        <span className="app-brand-mark"><Eye size={19} /></span>
        <div><strong>EyeProtect</strong><span>Quiet Focus</span></div>
      </div>
      <nav className="primary-nav" aria-label="主要导航">
        {primaryItems.map(({ id, label, description, icon, count }) => (
          <NavItem
            key={id}
            icon={icon}
            label={label}
            description={description}
            count={count}
            selected={section === id}
            onClick={() => onSelect(id)}
          />
        ))}
      </nav>
      <ProjectList
        projects={projects}
        tasks={tasks}
        selectedProjectId={selectedProjectId}
        onSelect={onSelectProject}
        unclassifiedSelected={unclassifiedSelected}
        onSelectUnclassified={onSelectUnclassified}
        createOpen={projectCreateOpen}
        onCreateOpenChange={onProjectCreateOpenChange}
      />
      <nav className="utility-nav" aria-label="辅助导航">
        {utilityItems.map(({ id, label, description, icon }) => (
          <NavItem
            key={id}
            icon={icon}
            label={label}
            description={description}
            selected={section === id}
            onClick={() => onSelect(id)}
          />
        ))}
      </nav>
    </aside>
  );
}
