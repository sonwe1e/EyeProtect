import { lazy, Suspense } from 'react';

const AlertView = lazy(() => import('./views/AlertView'));
const BubbleView = lazy(() => import('./views/BubbleView'));
const PanelView = lazy(() => import('./views/PanelView'));
const PetView = lazy(() => import('./views/PetView'));
const SettingsView = lazy(() => import('./views/SettingsView'));
const WorkbenchView = lazy(() => import('./views/WorkbenchView'));

const route = window.location.hash.replace('#', '') || 'pet';

const resolveView = () => {
  switch (route) {
    case 'alert':
      return AlertView;
    case 'bubble':
      return BubbleView;
    case 'panel':
      return PanelView;
    case 'settings':
      return SettingsView;
    case 'workbench':
      return WorkbenchView;
    default:
      return PetView;
  }
};

export function App(): JSX.Element {
  const View = resolveView();
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
