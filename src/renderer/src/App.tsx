import { lazy, Suspense, useEffect } from 'react';
import { useSettings } from './hooks/useSettings';

const AlertView = lazy(() => import('./views/AlertView'));
const BubbleView = lazy(() => import('./views/BubbleView'));
const PetView = lazy(() => import('./views/PetView'));
const WorkbenchView = lazy(() => import('./views/WorkbenchView'));

const route = window.location.hash.replace('#', '') || 'pet';

const resolveView = () => {
  switch (route) {
    case 'alert':
      return AlertView;
    case 'bubble':
      return BubbleView;
    case 'panel':
    case 'settings':
      return WorkbenchView;
    case 'workbench':
      return WorkbenchView;
    default:
      return PetView;
  }
};

export function App(): JSX.Element {
  const View = resolveView();
  const { settings } = useSettings();
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.density = settings.density;
    document.documentElement.style.colorScheme = settings.theme === 'system' ? 'light dark' : settings.theme;
  }, [settings.theme, settings.density]);
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
