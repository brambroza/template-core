import { useLocalSearchParams } from 'expo-router';
import { ModuleScreen } from '../../../../src/components/ModuleScreen';

export default function ScreenWithIdRoute() {
  const p = useLocalSearchParams<{ module: string; screen: string; id: string }>();
  return <ModuleScreen module={p.module} screen={p.screen} id={decodeURIComponent(p.id)} />;
}
